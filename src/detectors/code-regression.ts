import { Detector, DetectorInput, createEvidenceItem } from './base.js';
import { DetectorResult, EvidenceItem } from '../core/types.js';
import { generateFingerprint } from '../parser/fingerprint.js';

/**
 * Normalizes file paths for clean matching between stack traces/logs and PR changedFiles.
 * E.g., "/home/runner/work/repo/repo/src/auth/login.ts" -> "src/auth/login.ts"
 * E.g., "./src/auth/login.ts" -> "src/auth/login.ts"
 */
export function normalizeFilePath(path: string): string {
  if (!path) return '';
  let cleaned = path.replace(/\\/g, '/');
  // Strip leading dots or slashes
  cleaned = cleaned.replace(/^\.\//, '').replace(/^\//, '');

  // Strip GitHub Actions runner prefixes
  const runnerWorkMatch = cleaned.match(
    /(?:home\/runner\/work\/[^\/]+\/[^\/]+\/|github\/workspace\/)(.+)/i,
  );
  if (runnerWorkMatch) {
    cleaned = runnerWorkMatch[1];
  }

  // Strip line numbers or column suffixes if appended (e.g. "src/auth.ts:42:10")
  cleaned = cleaned.split(':')[0];

  return cleaned.trim();
}

// Regex to detect file paths in stack traces / test runners / error logs
const FILE_PATH_EXTRACT_PATTERN =
  /\b(?:at\s+.*?\s+\()?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)(?::\d+)*\)?/g;

export class CodeRegressionDetector implements Detector {
  public readonly id = 'code_regression';
  public readonly category = 'CODE_REGRESSION';

  public detect(input: DetectorInput): DetectorResult | null {
    const { parseResult, context } = input;
    if (
      !context.changedFiles ||
      context.changedFiles.length === 0 ||
      parseResult.frames.length === 0
    ) {
      return null;
    }

    const normalizedChangedFiles = context.changedFiles.map(normalizeFilePath);
    const evidence: EvidenceItem[] = [];
    let matchedChangedFile = '';
    let primaryRawError = '';

    for (const frame of parseResult.frames) {
      const linesToSearch = [
        frame.rawErrorLine,
        ...(frame.fingerprint.fileLocation ? [frame.fingerprint.fileLocation] : []),
        ...frame.linesBefore,
        ...frame.linesAfter,
      ];

      for (const line of linesToSearch) {
        let match: RegExpExecArray | null;
        // Reset regex state for global matching
        FILE_PATH_EXTRACT_PATTERN.lastIndex = 0;

        while ((match = FILE_PATH_EXTRACT_PATTERN.exec(line)) !== null) {
          const candidatePath = normalizeFilePath(match[1]);
          if (!candidatePath) continue;

          // Check if candidatePath matches any changed file
          const isMatch = normalizedChangedFiles.some(
            (changed) =>
              changed === candidatePath ||
              candidatePath.endsWith(changed) ||
              changed.endsWith(candidatePath),
          );

          if (isMatch) {
            matchedChangedFile = candidatePath;
            if (!primaryRawError) primaryRawError = frame.rawErrorLine;

            evidence.push(
              createEvidenceItem(
                `diff_correlation_${frame.id}`,
                'diff_correlation',
                `Failure location "${candidatePath}" directly correlates with modified file "${candidatePath}" in pull request.`,
                90,
                line,
              ),
            );
            break;
          }
        }
        if (matchedChangedFile) break;
      }
      if (matchedChangedFile) break;
    }

    if (!matchedChangedFile || evidence.length === 0) {
      return null;
    }

    const minConfidence = context.config.minRegressionConfidence ?? 80;
    const confidenceScore = Math.max(minConfidence, 85);

    const fingerprint = generateFingerprint(
      primaryRawError || parseResult.frames[0].rawErrorLine,
      context.config.customSecretPatterns,
      matchedChangedFile || parseResult.frames[0].fingerprint.fileLocation,
    );

    return {
      category: 'CODE_REGRESSION',
      confidenceScore,
      evidence,
      fingerprint,
      suggestedAction: `Review recent pull request modifications in "${matchedChangedFile}" for logic regressions.`,
    };
  }
}
