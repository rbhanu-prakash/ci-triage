import { Detector, DetectorInput, createEvidenceItem } from './base.js';
import { DetectorResult, EvidenceItem, HistoricalRun } from '../core/types.js';
import { generateFingerprint } from '../parser/fingerprint.js';

interface ConfirmedTransition {
  failureRun: HistoricalRun;
  successRun: HistoricalRun;
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
    const failureRuns: HistoricalRun[] = [];
    const successRuns: HistoricalRun[] = [];

    for (const frame of parseResult.frames) {
      const fingerprint = generateFingerprint(
        frame.rawErrorLine,
        context.config.customSecretPatterns,
        frame.fingerprint.fileLocation,
      );

      // Search across historical runs for matching fingerprint evidence
      for (const run of context.historicalRuns) {
        const hasFingerprint = run.fingerprints.includes(fingerprint.canonicalHash);

        if (hasFingerprint) {
          if (run.conclusion === 'failure') {
            if (!failureRuns.some((r) => r.runId === run.runId)) {
              failureRuns.push(run);
            }
          } else if (run.conclusion === 'success') {
            if (!successRuns.some((r) => r.runId === run.runId)) {
              successRuns.push(run);
            }
          }
          if (!primaryRawError) {
            primaryRawError = frame.rawErrorLine;
          }
        }
      }
    }

    // Must have observed both failure evidence AND success evidence
    if (failureRuns.length === 0 || successRuns.length === 0) {
      return null;
    }

    // Find confirmed comparable failure -> subsequent success transitions
    const confirmedTransitions: ConfirmedTransition[] = [];

    for (const failRun of failureRuns) {
      for (const succRun of successRuns) {
        // Scope / comparability check: must share same workflowId or same commitSha
        const isSameWorkflow =
          Boolean(failRun.workflowId) &&
          Boolean(succRun.workflowId) &&
          failRun.workflowId === succRun.workflowId;
        const isSameCommit =
          Boolean(failRun.commitSha) &&
          Boolean(succRun.commitSha) &&
          failRun.commitSha === succRun.commitSha;

        if (!isSameWorkflow && !isSameCommit) {
          continue; // Unrelated runs
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

        if (isSubsequent) {
          confirmedTransitions.push({ failureRun: failRun, successRun: succRun });
        }
      }
    }

    // If no confirmed comparable failure->success transitions are found, return null conservatively
    if (confirmedTransitions.length === 0) {
      return null;
    }

    // Build evidence items for confirmed transitions
    for (const transition of confirmedTransitions) {
      evidence.push(
        createEvidenceItem(
          `history_flaky_transition_${transition.failureRun.runId}_${transition.successRun.runId}`,
          'history_match',
          `Confirmed failure->subsequent success transition: run #${transition.failureRun.runId} failed and subsequent run #${transition.successRun.runId} succeeded for workflow "${transition.failureRun.workflowId || 'default'}".`,
          85,
          primaryRawError || parseResult.frames[0].rawErrorLine,
        ),
      );
    }

    // Calculate confidence based on independent confirmed transitions
    let calculatedConfidence = 75; // Base confidence for 1 confirmed failure->success transition
    if (confirmedTransitions.length >= 2) {
      calculatedConfidence = 85;
    }
    if (confirmedTransitions.length >= 3) {
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
