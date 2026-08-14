import { Detector, DetectorInput, createEvidenceItem } from './base.js';
import { DetectorResult, EvidenceItem, HistoricalRun } from '../core/types.js';
import { generateFingerprint } from '../parser/fingerprint.js';

interface ComparableTransition {
  failureRun: HistoricalRun;
  successRun: HistoricalRun;
  reason: string;
}

export class FlakyTestDetector implements Detector {
  public readonly id = 'flaky_test';
  public readonly category = 'FLAKY_TEST';

  public detect(input: DetectorInput): DetectorResult | null {
    const { parseResult, context } = input;
    if (
      !context.historicalRuns ||
      context.historicalRuns.length === 0 ||
      parseResult.frames.length === 0
    ) {
      return null;
    }

    const evidence: EvidenceItem[] = [];
    let primaryRawError = '';
    let failedTestIdentifier = '';
    const failureRunsWithMatchingFingerprint: HistoricalRun[] = [];

    for (const frame of parseResult.frames) {
      const fingerprint = generateFingerprint(
        frame.rawErrorLine,
        context.config.customSecretPatterns,
        frame.fingerprint.fileLocation,
      );

      // Search across historical failed runs for matching failure fingerprint
      for (const run of context.historicalRuns) {
        if (run.conclusion === 'failure' && run.fingerprints.includes(fingerprint.canonicalHash)) {
          if (!failureRunsWithMatchingFingerprint.some((r) => r.runId === run.runId)) {
            failureRunsWithMatchingFingerprint.push(run);
          }
          if (!primaryRawError) {
            primaryRawError = frame.rawErrorLine;
          }
          if (!failedTestIdentifier) {
            if (frame.fingerprint.fileLocation) {
              failedTestIdentifier = frame.fingerprint.fileLocation;
            } else {
              // Extract potential test file path or test signature from error frame lines
              const allLines = [frame.rawErrorLine, ...frame.linesBefore, ...frame.linesAfter].join(
                '\n',
              );
              const pathMatch = allLines.match(
                /\b([a-zA-Z0-9_\\\-./]+\.(?:test|spec)\.[a-zA-Z0-9]+(?::\d+)*)\b/i,
              );
              if (pathMatch) {
                failedTestIdentifier = pathMatch[1];
              }
            }
          }
        }
      }
    }

    // Must have observed historical failure runs with the matching failure fingerprint
    if (failureRunsWithMatchingFingerprint.length === 0) {
      return null;
    }

    // Find reliably comparable failure -> subsequent success transitions.
    //
    // A workflow-level failure followed by an arbitrary later workflow success is NOT sufficient
    // by itself to prove that the same test or failure condition passed later.
    //
    // Reliable comparability requires at least one of:
    // 1. Same-commit rerun/retry (success on same commit SHA or explicit isRerunOf link)
    // 2. Specific test identity matching: the failed test/location is explicitly recorded as passed in testsPassed
    // 3. Granular job comparability on the exact same branch with predecessor run linkage
    const comparableTransitions: ComparableTransition[] = [];

    for (const failRun of failureRunsWithMatchingFingerprint) {
      for (const succRun of context.historicalRuns) {
        if (succRun.conclusion !== 'success') {
          continue;
        }

        // Sequential / ordering check: success run must occur strictly AFTER failure run
        const failTime = Date.parse(failRun.createdAt);
        const succTime = Date.parse(succRun.createdAt);

        let isSubsequent = false;
        if (!isNaN(failTime) && !isNaN(succTime)) {
          if (succTime > failTime) {
            isSubsequent = true;
          }
        } else if (typeof failRun.runId === 'number' && typeof succRun.runId === 'number') {
          if (succRun.runId > failRun.runId) {
            isSubsequent = true;
          }
        }

        if (!isSubsequent) {
          continue;
        }

        // Criterion 1: Identical commit rerun (same commit SHA tested failed then passed on retry)
        const isSameCommitRerun =
          Boolean(failRun.commitSha) &&
          Boolean(succRun.commitSha) &&
          failRun.commitSha === succRun.commitSha;

        // Criterion 2: Explicit rerun relationship
        const isExplicitRerun = succRun.isRerunOf === failRun.runId;

        // Criterion 3: Explicit test passing verification in test-level execution metadata
        const isSpecificTestPassed = Boolean(
          failedTestIdentifier &&
          succRun.testsPassed &&
          succRun.testsPassed.some(
            (t) => t.includes(failedTestIdentifier) || failedTestIdentifier.includes(t),
          ),
        );

        if (isSameCommitRerun) {
          comparableTransitions.push({
            failureRun: failRun,
            successRun: succRun,
            reason: `Identical commit retry (${failRun.commitSha.slice(0, 7)}) succeeded in run #${succRun.runId} after failing in run #${failRun.runId}`,
          });
        } else if (isExplicitRerun) {
          comparableTransitions.push({
            failureRun: failRun,
            successRun: succRun,
            reason: `Direct retry run #${succRun.runId} succeeded after failure in run #${failRun.runId}`,
          });
        } else if (isSpecificTestPassed) {
          comparableTransitions.push({
            failureRun: failRun,
            successRun: succRun,
            reason: `Failing test "${failedTestIdentifier}" recorded as passed in subsequent successful run #${succRun.runId}`,
          });
        }
        // Notice: If only workflowId matched across different commits with no retry/test proof,
        // we deliberately do NOT treat it as a comparable transition.
      }
    }

    // If no reliably comparable failure->success transitions are found, return null conservatively
    if (comparableTransitions.length === 0) {
      return null;
    }

    // Build evidence items for comparable transitions
    for (const transition of comparableTransitions) {
      evidence.push(
        createEvidenceItem(
          `history_flaky_transition_${transition.failureRun.runId}_${transition.successRun.runId}`,
          'history_match',
          `Comparable failure-to-success transition observed: ${transition.reason} for workflow "${transition.failureRun.workflowId || 'default'}".`,
          85,
          primaryRawError || parseResult.frames[0].rawErrorLine,
        ),
      );
    }

    // Calculate confidence based on independent comparable transitions
    let calculatedConfidence = 75; // Base confidence for 1 reliably comparable transition
    if (comparableTransitions.length >= 2) {
      calculatedConfidence = 85;
    }
    if (comparableTransitions.length >= 3) {
      calculatedConfidence = 90;
    }

    const minFlakyConfidence = context.config.minFlakyConfidence ?? 75;
    if (calculatedConfidence < minFlakyConfidence) {
      return null;
    }

    const fingerprint = generateFingerprint(
      primaryRawError || parseResult.frames[0].rawErrorLine,
      context.config.customSecretPatterns,
      parseResult.frames[0].fingerprint.fileLocation,
    );

    return {
      category: 'FLAKY_TEST',
      confidenceScore: calculatedConfidence,
      evidence,
      fingerprint,
      suggestedAction:
        'Investigate non-deterministic test behavior, race conditions, dynamic seed data, or timing sensitivities.',
    };
  }
}
