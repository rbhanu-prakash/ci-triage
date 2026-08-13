import { Detector, DetectorInput, createEvidenceItem } from './base.js';
import { DetectorResult, EvidenceItem, HistoricalRun } from '../core/types.js';
import { generateFingerprint } from '../parser/fingerprint.js';

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
    let historicalPasses = 0;
    let historicalFailures = 0;
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
            historicalFailures++;
            if (!failureRuns.some((r) => r.runId === run.runId)) {
              failureRuns.push(run);
            }
          } else if (run.conclusion === 'success') {
            historicalPasses++;
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

    // FLAKY_TEST safety rule: Must require multiple historical signals.
    // Must have historical failure evidence AND historical success evidence for matching fingerprint/context.
    if (historicalFailures === 0 || historicalPasses === 0) {
      return null;
    }

    // Build evidence items
    for (const run of failureRuns) {
      evidence.push(
        createEvidenceItem(
          `history_flaky_failure_${run.runId}`,
          'history_match',
          `Failure fingerprint "${fingerprintSlice(primaryRawError || parseResult.frames[0].rawErrorLine, context)}" was observed in failing historical run #${run.runId} (${run.createdAt}).`,
          80,
          primaryRawError || parseResult.frames[0].rawErrorLine,
        ),
      );
    }

    for (const run of successRuns) {
      evidence.push(
        createEvidenceItem(
          `history_flaky_success_${run.runId}`,
          'history_match',
          `Failure fingerprint "${fingerprintSlice(primaryRawError || parseResult.frames[0].rawErrorLine, context)}" was present in successful historical run #${run.runId} (${run.createdAt}).`,
          85,
          primaryRawError || parseResult.frames[0].rawErrorLine,
        ),
      );
    }

    // Calculate confidence based on multiple independent flaky signals
    let calculatedConfidence = 75; // Base confidence for 1 failure + 1 success match

    if (historicalFailures >= 2 && historicalPasses >= 2) {
      calculatedConfidence = 90;
    } else if (historicalFailures >= 2 || historicalPasses >= 2) {
      calculatedConfidence = 85;
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

function fingerprintSlice(rawErrorLine: string, context: DetectorInput['context']): string {
  const fp = generateFingerprint(rawErrorLine, context.config.customSecretPatterns);
  return fp.canonicalHash.slice(0, 8);
}
