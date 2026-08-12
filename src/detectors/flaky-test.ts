import { Detector, DetectorInput, createEvidenceItem } from './base.js';
import { DetectorResult, EvidenceItem } from '../core/types.js';
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

    for (const frame of parseResult.frames) {
      const fingerprint = generateFingerprint(
        frame.rawErrorLine,
        context.config.customSecretPatterns,
        frame.fingerprint.fileLocation,
      );

      // Search across historical runs for this fingerprint
      for (const run of context.historicalRuns) {
        const hasFingerprint = run.fingerprints.includes(fingerprint.canonicalHash);

        if (hasFingerprint && run.conclusion === 'success') {
          // Failure fingerprint observed in a successful workflow run
          historicalPasses++;
          evidence.push(
            createEvidenceItem(
              `history_flaky_success_${run.runId}`,
              'history_match',
              `Failure fingerprint "${fingerprint.canonicalHash.slice(0, 8)}" was present in successful historical run #${run.runId} (${run.createdAt}).`,
              90,
              frame.rawErrorLine,
            ),
          );
          if (!primaryRawError) {
            primaryRawError = frame.rawErrorLine;
          }
        } else if (hasFingerprint && run.conclusion === 'failure') {
          historicalFailures++;
        }
      }
    }

    // Check if intermittent pass/fail evidence was found
    if (historicalPasses === 0) {
      return null;
    }

    // Calculate confidence based on historical frequency
    const totalHistoricalMatches = historicalPasses + historicalFailures;
    const passRatio = historicalPasses / Math.max(1, totalHistoricalMatches);
    const calculatedConfidence = Math.min(95, Math.round(75 + passRatio * 20));

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
