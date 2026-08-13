import { Detector, DetectorInput, createEvidenceItem } from './base.js';
import { DetectorResult, EvidenceItem } from '../core/types.js';
import { generateFingerprint } from '../parser/fingerprint.js';

const TS_PATTERN = /\berror TS\d+:\s+[^\n]+/i;
const SYNTAX_PATTERN = /\b(?:SyntaxError|ParseError|Unexpected token)\b/i;
const BUNDLER_PATTERN =
  /(?:\[vite\] Build failed|Module build failed|Failed to compile|RollupError|\[esbuild\] Error)/i;
const COMPILER_PATTERN =
  /(?:gcc: error|g\+\+: error|cargo build failed|error\[E\d+\]|go build:|\.\/[a-zA-Z0-9_\-./]+\.go:\d+:\d+:|undefined:\s+[a-zA-Z0-9_]+)/i;

const TS_FILE_LOC_PATTERN = /([a-zA-Z0-9_\-./]+\.[jt]sx?)\((\d+,\d+)\):\s*error TS/i;

export class BuildDetector implements Detector {
  public readonly id = 'build';
  public readonly category = 'BUILD';

  public detect(input: DetectorInput): DetectorResult | null {
    const { parseResult, context } = input;
    if (parseResult.frames.length === 0) {
      return null;
    }

    const evidence: EvidenceItem[] = [];
    let primaryRawError = '';
    let fileLocation: string | undefined;

    for (const frame of parseResult.frames) {
      const allLines = [frame.rawErrorLine, ...frame.linesBefore, ...frame.linesAfter].join('\n');

      const tsMatch = TS_PATTERN.exec(allLines);
      if (tsMatch) {
        evidence.push(
          createEvidenceItem(
            `build_ts_${frame.id}`,
            'log_signature',
            `Observed TypeScript compilation error: "${tsMatch[0].slice(0, 150)}"`,
            95,
            tsMatch[0],
          ),
        );
        if (!primaryRawError) primaryRawError = tsMatch[0];

        const locMatch = TS_FILE_LOC_PATTERN.exec(allLines);
        if (locMatch && !fileLocation) {
          fileLocation = `${locMatch[1]}:${locMatch[2]}`;
        }
      }

      const syntaxMatch = SYNTAX_PATTERN.exec(allLines);
      const bundlerMatch = BUNDLER_PATTERN.exec(allLines);
      if (bundlerMatch) {
        evidence.push(
          createEvidenceItem(
            `build_bundler_${frame.id}`,
            'log_signature',
            `Observed bundler compilation error: "${bundlerMatch[0]}" in "${frame.rawErrorLine.slice(0, 150)}"`,
            90,
            frame.rawErrorLine,
          ),
        );
        if (!primaryRawError) primaryRawError = frame.rawErrorLine;
      }

      const compilerMatch = COMPILER_PATTERN.exec(allLines);
      if (compilerMatch) {
        evidence.push(
          createEvidenceItem(
            `build_compiler_${frame.id}`,
            'log_signature',
            `Observed compiler failure: "${compilerMatch[0]}" in "${frame.rawErrorLine.slice(0, 150)}"`,
            90,
            frame.rawErrorLine,
          ),
        );
        if (!primaryRawError) primaryRawError = frame.rawErrorLine;
      }

      if (syntaxMatch) {
        const hasExplicitCompilerOrBundler = tsMatch || bundlerMatch || compilerMatch;
        const hasBuildContext =
          hasExplicitCompilerOrBundler ||
          /\b(?:build|compile|compiling|compilation|tsc|webpack|vite|esbuild|rollup|next build|turbo build|cargo build|go build|npm run build|yarn build|pnpm build|ng build|make|gcc|g\+\+)\b/i.test(
            allLines,
          );
        const score = hasBuildContext ? 80 : 60;

        evidence.push(
          createEvidenceItem(
            `build_syntax_${frame.id}`,
            'log_signature',
            `Observed syntax error: "${frame.rawErrorLine.slice(0, 150)}"`,
            score,
            frame.rawErrorLine,
          ),
        );
        if (!primaryRawError) primaryRawError = frame.rawErrorLine;
      }
    }

    if (evidence.length === 0) {
      return null;
    }

    const confidenceScore = Math.max(...evidence.map((e) => e.relevanceScore));
    const fingerprint = generateFingerprint(
      primaryRawError || parseResult.frames[0].rawErrorLine,
      context.config.customSecretPatterns,
      fileLocation || parseResult.frames[0].fingerprint.fileLocation,
    );

    return {
      category: 'BUILD',
      confidenceScore,
      evidence,
      fingerprint,
      suggestedAction:
        'Resolve TypeScript compilation errors, syntax errors, or bundler module resolution issues.',
    };
  }
}
