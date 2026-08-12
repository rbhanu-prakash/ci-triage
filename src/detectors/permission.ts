import { Detector, DetectorInput, createEvidenceItem } from './base.js';
import { DetectorResult, EvidenceItem } from '../core/types.js';
import { generateFingerprint } from '../parser/fingerprint.js';

const PERM_PATTERN =
  /\b(?:Permission denied|EACCES|EPERM|401 Unauthorized|403 Forbidden|AccessDenied|Resource not accessible by integration|invalid token|Authentication required|Bad credentials|Token expired|Permission denied \(publickey\)|Host key verification failed|HTTP 401|HTTP 403)\b/i;

export class PermissionDetector implements Detector {
  public readonly id = 'permission';
  public readonly category = 'PERMISSION';

  public detect(input: DetectorInput): DetectorResult | null {
    const { parseResult, context } = input;
    if (parseResult.frames.length === 0) {
      return null;
    }

    const evidence: EvidenceItem[] = [];
    let primaryRawError = '';

    for (const frame of parseResult.frames) {
      const allLines = [frame.rawErrorLine, ...frame.linesBefore, ...frame.linesAfter].join('\n');
      const match = PERM_PATTERN.exec(allLines);

      if (match) {
        evidence.push(
          createEvidenceItem(
            `perm_${frame.id}`,
            'log_signature',
            `Observed permission/authentication failure: "${match[0]}" in "${frame.rawErrorLine.slice(0, 150)}"`,
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

    const confidenceScore = 90;
    const fingerprint = generateFingerprint(
      primaryRawError || parseResult.frames[0].rawErrorLine,
      context.config.customSecretPatterns,
      parseResult.frames[0].fingerprint.fileLocation,
    );

    return {
      category: 'PERMISSION',
      confidenceScore,
      evidence,
      fingerprint,
      suggestedAction:
        'Verify authentication tokens, secret permissions, SSH key authorization, and workflow token permissions (e.g. id-token, contents).',
    };
  }
}
