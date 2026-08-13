import { Detector, DetectorInput, createEvidenceItem } from './base.js';
import { DetectorResult, EvidenceItem } from '../core/types.js';
import { generateFingerprint } from '../parser/fingerprint.js';

// Precompiled static regex patterns for test runner evidence
const TEST_SUMMARY_PATTERN =
  /\b(?:Tests|Test Suites):?\s+.*?\b(\d+)\s+failed\b|==+\s*(\d+)\s+failed.*==+|--- FAIL:\s+(\w+)/i;
const TEST_FAIL_HEADER_PATTERN =
  /^\s*(?:FAIL|FAILED|×)\s+([a-zA-Z0-9_\-./]+(?:::[a-zA-Z0-9_\-./]+)?)/im;
const ASSERTION_PATTERN =
  /\b(?:AssertionError|expect\((?:received|actual)\)|Expected:[\s\S]*?Received:|-\s*Expected:|\+\s*Received:)/i;

export class TestFailureDetector implements Detector {
  public readonly id = 'test_failure';
  public readonly category = 'TEST_FAILURE';

  public detect(input: DetectorInput): DetectorResult | null {
    const { parseResult, context } = input;
    if (parseResult.frames.length === 0) {
      return null;
    }

    const evidence: EvidenceItem[] = [];
    let primaryRawError = '';
    let fileLocation: string | undefined;

    let hasSummary = false;
    let hasHeader = false;
    let hasAssertion = false;
    let totalMatches = 0;

    for (const frame of parseResult.frames) {
      const allLines = [frame.rawErrorLine, ...frame.linesBefore, ...frame.linesAfter].join('\n');

      // Check test runner summary
      const summaryMatch = TEST_SUMMARY_PATTERN.exec(allLines);
      if (summaryMatch) {
        hasSummary = true;
        totalMatches++;
        evidence.push(
          createEvidenceItem(
            `test_summary_${frame.id}`,
            'log_signature',
            `Observed test runner failure summary: "${summaryMatch[0].trim()}"`,
            90,
            summaryMatch[0],
          ),
        );
        if (!primaryRawError) primaryRawError = summaryMatch[0];
      }

      // Check test fail header
      const failHeaderMatch = TEST_FAIL_HEADER_PATTERN.exec(allLines);
      if (failHeaderMatch) {
        hasHeader = true;
        totalMatches++;
        const target = failHeaderMatch[1];
        if (!fileLocation && target.includes('.')) {
          fileLocation = target.split('::')[0];
        }
        evidence.push(
          createEvidenceItem(
            `test_header_${frame.id}`,
            'log_signature',
            `Observed failing test signature: "${failHeaderMatch[0].trim()}"`,
            85,
            failHeaderMatch[0],
          ),
        );
        if (!primaryRawError) primaryRawError = failHeaderMatch[0];
      }

      // Check assertion error
      const assertionMatch = ASSERTION_PATTERN.exec(allLines);
      if (assertionMatch) {
        hasAssertion = true;
        totalMatches++;
        evidence.push(
          createEvidenceItem(
            `test_assertion_${frame.id}`,
            'log_signature',
            `Observed test assertion failure: "${frame.rawErrorLine.slice(0, 150)}"`,
            55,
            frame.rawErrorLine,
          ),
        );
        if (!primaryRawError) primaryRawError = frame.rawErrorLine;
      }
    }

    if (totalMatches === 0 || evidence.length === 0) {
      return null;
    }

    // Conservative evidence-weighted confidence calculation
    let baseConfidence = 0;
    if (hasSummary && hasHeader) {
      baseConfidence = 85;
    } else if (hasSummary) {
      baseConfidence = 80;
    } else if (hasHeader) {
      baseConfidence = 75;
    } else if (hasAssertion) {
      // Weak assertion-only evidence
      baseConfidence = 55;
    }

    // Boost if multiple independent signals exist
    const uniqueSignalTypes = (hasSummary ? 1 : 0) + (hasHeader ? 1 : 0) + (hasAssertion ? 1 : 0);
    const signalBonus = uniqueSignalTypes === 3 ? 10 : uniqueSignalTypes === 2 ? 5 : 0;

    const confidenceScore = Math.min(95, baseConfidence + signalBonus);
    const fingerprintLine = primaryRawError || parseResult.frames[0].rawErrorLine;
    const fingerprint = generateFingerprint(
      fingerprintLine,
      context.config.customSecretPatterns,
      fileLocation || parseResult.frames[0].fingerprint.fileLocation,
    );

    const targetLoc = fileLocation || 'the failing test suite';

    return {
      category: 'TEST_FAILURE',
      confidenceScore,
      evidence,
      fingerprint,
      suggestedAction: `Inspect the failing test assertion and execution details in ${targetLoc}.`,
    };
  }
}
