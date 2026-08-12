import { Detector, DetectorInput, createEvidenceItem } from './base.js';
import { DetectorResult, EvidenceItem } from '../core/types.js';
import { generateFingerprint } from '../parser/fingerprint.js';

const OOM_PATTERN =
  /\b(?:JavaScript heap out of memory|Allocation failed - JavaScript heap out of memory|MemoryLimitExceeded|OutOfMemoryError|std::bad_alloc|java\.lang\.OutOfMemoryError|Process killed due to memory|Memory limit exceeded)\b/i;

const DISK_PATTERN =
  /\b(?:No space left on device|ENOSPC|Disk full|write error: No space left|device out of space)\b/i;

const LIMIT_PATTERN =
  /\b(?:Resource temporarily unavailable|fork: Resource temporarily unavailable|Cannot allocate memory)\b/i;

export class ResourceDetector implements Detector {
  public readonly id = 'resource';
  public readonly category = 'RESOURCE';

  public detect(input: DetectorInput): DetectorResult | null {
    const { parseResult, context } = input;
    if (parseResult.frames.length === 0) {
      return null;
    }

    const evidence: EvidenceItem[] = [];
    let primaryRawError = '';

    for (const frame of parseResult.frames) {
      const allLines = [frame.rawErrorLine, ...frame.linesBefore, ...frame.linesAfter].join('\n');

      if (OOM_PATTERN.test(allLines)) {
        evidence.push(
          createEvidenceItem(
            `res_oom_${frame.id}`,
            'system_event',
            `Observed Out-of-Memory resource exhaustion: "${frame.rawErrorLine.slice(0, 150)}"`,
            95,
            frame.rawErrorLine,
          ),
        );
        if (!primaryRawError) primaryRawError = frame.rawErrorLine;
      }

      if (DISK_PATTERN.test(allLines)) {
        evidence.push(
          createEvidenceItem(
            `res_disk_${frame.id}`,
            'system_event',
            `Observed disk space exhaustion: "${frame.rawErrorLine.slice(0, 150)}"`,
            95,
            frame.rawErrorLine,
          ),
        );
        if (!primaryRawError) primaryRawError = frame.rawErrorLine;
      }

      if (LIMIT_PATTERN.test(allLines)) {
        evidence.push(
          createEvidenceItem(
            `res_limit_${frame.id}`,
            'system_event',
            `Observed system process/resource limit: "${frame.rawErrorLine.slice(0, 150)}"`,
            90,
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
      category: 'RESOURCE',
      confidenceScore,
      evidence,
      fingerprint,
      suggestedAction:
        'Increase runner memory or disk allocation limits, prune build caches, or optimize resource-heavy build steps.',
    };
  }
}
