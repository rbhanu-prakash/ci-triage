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

function stripExtension(path: string): string {
  return path.replace(/\.(?:d\.ts|tsx?|jsx?|mjs|cjs|py|go|rs|java|rb|php|cs)$/i, '');
}

/**
 * Checks if a candidate file path from log correlates with a changed file path from PR.
 * Prevents overly broad endsWith collisions (e.g., "a/b/index.ts" matching "x/y/index.ts").
 */
export function isPathMatch(
  candidatePath: string,
  changedPath: string,
): { isMatch: boolean; isExact: boolean } {
  const normC = normalizeFilePath(candidatePath);
  const normR = normalizeFilePath(changedPath);
  if (!normC || !normR) return { isMatch: false, isExact: false };

  // 1. Exact path match
  if (normC === normR) {
    return { isMatch: true, isExact: true };
  }

  // 2. Subpath suffix match on directory boundary (e.g. "packages/auth/src/login.ts" vs "src/login.ts")
  if (normC.endsWith('/' + normR) || normR.endsWith('/' + normC)) {
    return { isMatch: true, isExact: false };
  }

  // 3. Extension-agnostic stem match (e.g. "dist/auth/login.js" vs "src/auth/login.ts")
  const stemC = stripExtension(normC);
  const stemR = stripExtension(normR);

  if (stemC === stemR) {
    return { isMatch: true, isExact: true };
  }

  if (stemC.endsWith('/' + stemR) || stemR.endsWith('/' + stemC)) {
    return { isMatch: true, isExact: false };
  }

  // Common suffix check for build output directories (dist/..., build/...) matching source files
  const partsC = stemC.split('/');
  const partsR = stemR.split('/');

  let commonSegments = 0;
  while (
    commonSegments < partsC.length &&
    commonSegments < partsR.length &&
    partsC[partsC.length - 1 - commonSegments] === partsR[partsR.length - 1 - commonSegments]
  ) {
    commonSegments++;
  }

  // If at least 2 path segments match at the tail (e.g. "auth/login"), or 1 non-generic segment
  if (commonSegments >= 2) {
    return { isMatch: true, isExact: false };
  }
  if (commonSegments === 1 && partsC[partsC.length - 1] !== 'index') {
    return { isMatch: true, isExact: false };
  }

  return { isMatch: false, isExact: false };
}

// Regex to detect file paths in stack traces / test runners / error logs (supports Windows \ and POSIX /)
const FILE_PATH_EXTRACT_PATTERN =
  /\b(?:at\s+.*?\s+\()?([a-zA-Z0-9_\\\-./]+\.[a-zA-Z0-9]+)(?::\d+)*\)?/g;

// Patterns indicating external systemic failures (Network, Dependency, Resource, Permission)
const SYSTEMIC_FAILURE_PATTERN =
  /\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ERESOLVE|EACCES|ENOSPC|heap out of memory)\b/i;

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

    const evidence: EvidenceItem[] = [];
    let matchedChangedFile = '';
    let primaryRawError = '';

    let isExactStackTraceMatch = false;
    let isSourceOrTestLocation = false;
    let hasSystemicErrorSignature = false;

    for (const frame of parseResult.frames) {
      const frameText = [frame.rawErrorLine, ...frame.linesBefore, ...frame.linesAfter].join('\n');

      if (SYSTEMIC_FAILURE_PATTERN.test(frameText)) {
        hasSystemicErrorSignature = true;
      }

      // Check frame fingerprint fileLocation (exact stack location)
      if (frame.fingerprint.fileLocation) {
        for (const changedFile of context.changedFiles) {
          const matchResult = isPathMatch(frame.fingerprint.fileLocation, changedFile);
          if (matchResult.isMatch) {
            matchedChangedFile = changedFile;
            isExactStackTraceMatch = true;
            if (
              /\b(?:src|lib|app|components|services|controllers|tests?|specs?)\b/i.test(
                changedFile,
              ) ||
              /\.(?:test|spec)\.[a-z]+$/i.test(changedFile)
            ) {
              isSourceOrTestLocation = true;
            }
            if (!primaryRawError) primaryRawError = frame.rawErrorLine;

            evidence.push(
              createEvidenceItem(
                `diff_correlation_stack_${frame.id}`,
                'diff_correlation',
                `Stack trace location "${frame.fingerprint.fileLocation}" directly correlates with modified pull request file "${changedFile}".`,
                80,
                frame.rawErrorLine,
              ),
            );
            break;
          }
        }
      }

      if (matchedChangedFile) break;

      // Extract paths from raw error line and surrounding frame lines
      const linesToSearch = [frame.rawErrorLine, ...frame.linesBefore, ...frame.linesAfter];

      for (const line of linesToSearch) {
        FILE_PATH_EXTRACT_PATTERN.lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = FILE_PATH_EXTRACT_PATTERN.exec(line)) !== null) {
          const candidatePath = match[1];

          for (const changedFile of context.changedFiles) {
            const matchResult = isPathMatch(candidatePath, changedFile);
            if (matchResult.isMatch) {
              matchedChangedFile = changedFile;
              if (matchResult.isExact) isExactStackTraceMatch = true;
              if (
                /\b(?:src|lib|app|components|services|controllers|tests?|specs?)\b/i.test(
                  changedFile,
                ) ||
                /\.(?:test|spec)\.[a-z]+$/i.test(changedFile)
              ) {
                isSourceOrTestLocation = true;
              }
              if (!primaryRawError) primaryRawError = frame.rawErrorLine;

              evidence.push(
                createEvidenceItem(
                  `diff_correlation_log_${frame.id}`,
                  'diff_correlation',
                  `Log line file path "${candidatePath}" correlates with modified pull request file "${changedFile}".`,
                  60,
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
      if (matchedChangedFile) break;
    }

    if (!matchedChangedFile || evidence.length === 0) {
      return null;
    }

    // Check if failure fingerprint is new/unseen in historical context
    const primaryError = primaryRawError || parseResult.frames[0].rawErrorLine;
    const fingerprint = generateFingerprint(
      primaryError,
      context.config.customSecretPatterns,
      matchedChangedFile || parseResult.frames[0].fingerprint.fileLocation,
    );

    let isNewFingerprint = false;
    if (context.historicalRuns && context.historicalRuns.length > 0) {
      const existsInHistory = context.historicalRuns.some((run) =>
        run.fingerprints.includes(fingerprint.canonicalHash),
      );
      if (!existsInHistory) {
        isNewFingerprint = true;
      }
    }

    // Calculate conservative multi-signal confidence score
    // Base score for log mention overlap alone: 50
    let confidenceScore = 50;

    if (isExactStackTraceMatch) {
      confidenceScore += 15; // Exact stack trace / file location correlation
    }
    if (isSourceOrTestLocation) {
      confidenceScore += 10; // Source code or test file location
    }
    if (isNewFingerprint) {
      confidenceScore += 10; // New/unseen failure fingerprint supporting evidence
    }
    if (!hasSystemicErrorSignature) {
      confidenceScore += 5; // Absence of competing network/dep/resource signatures
    }

    // Cap confidence score
    confidenceScore = Math.min(85, confidenceScore);

    // If minRegressionConfidence threshold configured and score is lower, return null conservatively
    if (
      context.config.minRegressionConfidence &&
      confidenceScore < context.config.minRegressionConfidence
    ) {
      return null;
    }

    return {
      category: 'CODE_REGRESSION',
      confidenceScore,
      evidence,
      fingerprint,
      suggestedAction: `Review recent pull request modifications in "${matchedChangedFile}" for possible logic regressions.`,
    };
  }
}
