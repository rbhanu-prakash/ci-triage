import { Detector, DetectorInput, createEvidenceItem } from './base.js';
import { DetectorResult, EvidenceItem } from '../core/types.js';
import { generateFingerprint } from '../parser/fingerprint.js';

const SOCKET_NET_PATTERN =
  /\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|connection reset|connection refused|getaddrinfo ENOTFOUND|Could not resolve host|Name or service not known|FetchError|NetworkError|Failed to fetch)\b/i;

const HTTP_NET_STATUS_PATTERN =
  /\b(?:HTTP|status code)\s*(?:408|429|500|502|503|504)\b|\b(?:502 Bad Gateway|503 Service Unavailable|504 Gateway Timeout|429 Too Many Requests)\b/i;

const TEST_ASSERTION_PATTERN = /\b(?:expect\(|AssertionError|toEqual|toBe\(|assert\b)/i;

export class NetworkDetector implements Detector {
  public readonly id = 'network';
  public readonly category = 'NETWORK';

  public detect(input: DetectorInput): DetectorResult | null {
    const { parseResult, context } = input;
    if (parseResult.frames.length === 0) {
      return null;
    }

    const evidence: EvidenceItem[] = [];
    let primaryRawError = '';

    for (const frame of parseResult.frames) {
      const allLines = [frame.rawErrorLine, ...frame.linesBefore, ...frame.linesAfter].join('\n');

      const socketMatch = SOCKET_NET_PATTERN.exec(allLines);
      if (socketMatch) {
        evidence.push(
          createEvidenceItem(
            `net_socket_${frame.id}`,
            'log_signature',
            `Observed network error signature: "${socketMatch[0]}" in "${frame.rawErrorLine.slice(0, 150)}"`,
            95,
            frame.rawErrorLine,
          ),
        );
        if (!primaryRawError) primaryRawError = frame.rawErrorLine;
      }

      const httpMatch = HTTP_NET_STATUS_PATTERN.exec(allLines);
      if (httpMatch) {
        // Conservative check: verify this isn't an application test runner asserting HTTP status
        const isTestAssertion = TEST_ASSERTION_PATTERN.test(allLines);
        if (!isTestAssertion || socketMatch) {
          evidence.push(
            createEvidenceItem(
              `net_http_${frame.id}`,
              'log_signature',
              `Observed HTTP network status error: "${httpMatch[0]}" in "${frame.rawErrorLine.slice(0, 150)}"`,
              isTestAssertion ? 60 : 85,
              frame.rawErrorLine,
            ),
          );
          if (!primaryRawError) primaryRawError = frame.rawErrorLine;
        }
      }
    }

    if (evidence.length === 0) {
      return null;
    }

    // Filter out low-confidence evidence if stronger signatures exist
    const topRelevance = Math.max(...evidence.map((e) => e.relevanceScore));
    const confidenceScore = topRelevance >= 90 ? 95 : 80;

    const fingerprint = generateFingerprint(
      primaryRawError || parseResult.frames[0].rawErrorLine,
      context.config.customSecretPatterns,
      parseResult.frames[0].fingerprint.fileLocation,
    );

    return {
      category: 'NETWORK',
      confidenceScore,
      evidence,
      fingerprint,
      suggestedAction:
        'Verify remote service endpoint availability, DNS configuration, network proxies, or retry transient network requests.',
    };
  }
}
