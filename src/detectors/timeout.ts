import { Detector, DetectorInput, createEvidenceItem } from './base.js';
import { DetectorResult, EvidenceItem } from '../core/types.js';
import { generateFingerprint } from '../parser/fingerprint.js';

const TIMEOUT_PATTERN =
  /\b(?:The job has exceeded the maximum execution time|The operation was canceled|Operation timed out|command timed out|Timeout of \d+ms exceeded|Step time limit exceeded|runner cancellation due to timeout|Task timed out after|exceeded timeout of|Async callback was not invoked within the \d+\s*ms timeout)\b/i;

export class TimeoutDetector implements Detector {
  public readonly id = 'timeout';
  public readonly category = 'TIMEOUT';

  public detect(input: DetectorInput): DetectorResult | null {
    const { parseResult, context } = input;
    if (parseResult.frames.length === 0) {
      return null;
    }

    const evidence: EvidenceItem[] = [];
    let primaryRawError = '';

    for (const frame of parseResult.frames) {
      const allLines = [frame.rawErrorLine, ...frame.linesBefore, ...frame.linesAfter].join('\n');
      const match = TIMEOUT_PATTERN.exec(allLines);

      if (match) {
        evidence.push(
          createEvidenceItem(
            `timeout_${frame.id}`,
            'system_event',
            `Observed timeout signature: "${match[0]}" in "${frame.rawErrorLine.slice(0, 150)}"`,
            95,
            frame.rawErrorLine,
          ),
        );
        if (!primaryRawError) primaryRawError = frame.rawErrorLine;
      }
    }

    if (evidence.length === 0) {
      return null;
    }

    const confidenceScore = 95;
    const fingerprint = generateFingerprint(
      primaryRawError || parseResult.frames[0].rawErrorLine,
      context.config.customSecretPatterns,
      parseResult.frames[0].fingerprint.fileLocation,
    );

    return {
      category: 'TIMEOUT',
      confidenceScore,
      evidence,
      fingerprint,
      suggestedAction:
        'Increase workflow/step timeout limits, optimize long-running execution steps, or break tasks into parallel jobs.',
    };
  }
}
