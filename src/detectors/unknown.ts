import { Detector, DetectorInput, createEvidenceItem } from './base.js';
import { DetectorResult } from '../core/types.js';
import { generateFingerprint } from '../parser/fingerprint.js';

export class UnknownDetector implements Detector {
  public readonly id = 'unknown';
  public readonly category = 'UNKNOWN';

  public detect(input: DetectorInput): DetectorResult {
    const { parseResult, context } = input;

    const rawLine =
      parseResult.frames.length > 0
        ? parseResult.frames[0].rawErrorLine
        : 'Unmapped failure signature in log stream';

    const fingerprint = generateFingerprint(
      rawLine,
      context.config.customSecretPatterns,
      parseResult.frames[0]?.fingerprint.fileLocation,
    );

    const evidence = [
      createEvidenceItem(
        'unknown_fallback_signature',
        'system_event',
        'No deterministic failure pattern matched the observed log frames and context.',
        0,
        rawLine,
      ),
    ];

    return {
      category: 'UNKNOWN',
      confidenceScore: 0,
      evidence,
      fingerprint,
      suggestedAction:
        'Manually inspect the full build log to identify unmapped error signatures or unknown failure modes.',
    };
  }
}
