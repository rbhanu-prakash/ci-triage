import { Detector, DetectorInput, createEvidenceItem } from './base.js';
import { DetectorResult, EvidenceItem } from '../core/types.js';
import { generateFingerprint } from '../parser/fingerprint.js';

const SOCKET_NET_PATTERN =
  /\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|connection reset|connection refused|getaddrinfo ENOTFOUND|Could not resolve host|Name or service not known|FetchError|NetworkError|Failed to fetch)\b/i;

const HTTP_NET_STATUS_PATTERN =
  /\b(?:HTTP|status code|Status)\s*(?:408|429|500|502|503|504)\b|\b(?:502 Bad Gateway|503 Service Unavailable|504 Gateway Timeout|429 Too Many Requests)\b/i;

const TEST_ASSERTION_PATTERN =
  /\b(?:expect\(|AssertionError|toEqual|toBe\(|assert\b|expected status|status_code ==)\b/i;

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
    let hasTransportFailure = false;

    for (const frame of parseResult.frames) {
      const allLines = [frame.rawErrorLine, ...frame.linesBefore, ...frame.linesAfter].join('\n');

      const isTestAssertion = TEST_ASSERTION_PATTERN.test(allLines);
      const socketMatch = SOCKET_NET_PATTERN.exec(allLines);

      if (socketMatch) {
        hasTransportFailure = true;
        evidence.push(
          createEvidenceItem(
            `net_socket_${frame.id}`,
            'log_signature',
            `Observed transport network error signature: "${socketMatch[0]}" in "${frame.rawErrorLine.slice(0, 150)}"`,
            95,
            frame.rawErrorLine,
          ),
        );
        if (!primaryRawError) primaryRawError = frame.rawErrorLine;
      }

      const httpMatch = HTTP_NET_STATUS_PATTERN.exec(allLines);
      if (httpMatch) {
        // Filter out test runner assertions comparing HTTP status codes
        if (!isTestAssertion || socketMatch) {
          evidence.push(
            createEvidenceItem(
              `net_http_${frame.id}`,
              'log_signature',
              `Observed HTTP network status response: "${httpMatch[0]}" in "${frame.rawErrorLine.slice(0, 150)}"`,
              socketMatch ? 85 : 60,
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

    // Determine overall confidence based on evidence signals
    // Strong transport failure (ECONNREFUSED, socket hang up) => high confidence (95)
    // Generic HTTP status (500, 429, etc.) without transport failure => moderate/ambiguous (60)
    const confidenceScore = hasTransportFailure ? 95 : 60;

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
