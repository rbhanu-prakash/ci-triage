/**
 * Parser Layer: Canonical Fingerprinting System
 *
 * Transforms raw error log lines into deterministic SHA-256 canonical fingerprints.
 * Pipeline:
 *   raw log line
 *       ↓
 *   secret redaction
 *       ↓
 *   ANSI/noise removal
 *       ↓
 *   volatile-value normalization
 *       ↓
 *   canonical representation
 *       ↓
 *   SHA-256 fingerprint
 */

import { createHash } from 'node:crypto';
import { redactSecrets } from '../security/redactor.js';
import { FailureFingerprint } from '../core/types.js';

/**
 * Removes ANSI escape codes from string.
 */
export function stripAnsi(text: string): string {
  if (!text) return text;
  // Matches standard ANSI color/control codes
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

/**
 * Normalizes volatile values (timestamps, IPs, UUIDs, temp paths, PIDs, hex addresses)
 * without destroying meaningful error numbers (e.g., "Expected 2 but received 5").
 */
export function normalizeVolatileValues(text: string): string {
  if (!text) return text;

  let normalized = text;

  // 1. Timestamps & ISO dates
  // ISO dates: 2026-08-12T10:21:44.123Z, 2026-08-12 10:21:44
  normalized = normalized.replace(
    /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/gi,
    '<TIMESTAMP>',
  );
  // Time-only: 10:21:44.123 or 10:21:44
  normalized = normalized.replace(/\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/g, '<TIMESTAMP>');
  // Month-day timestamps: Aug 12 10:21:44
  normalized = normalized.replace(
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\b/gi,
    '<TIMESTAMP>',
  );

  // 2. IP Addresses & Ports
  // IPv4 with optional port: 10.20.4.8:443 or 10.20.4.8
  normalized = normalized.replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, (match) => {
    return match.includes(':') ? '<IP>:<PORT>' : '<IP>';
  });
  // IPv6 with optional port
  normalized = normalized.replace(/\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g, '<IP>');
  // Explicit port references: "port 8080"
  normalized = normalized.replace(/\bport\s+\d{2,5}\b/gi, 'port <PORT>');

  // 3. UUIDs
  normalized = normalized.replace(
    /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
    '<UUID>',
  );

  // 4. Request / Trace / Span IDs
  normalized = normalized.replace(
    /\b(?:req|request|txn|trace|span)[-_][0-9a-fA-F]{8,32}\b/gi,
    '<REQ_ID>',
  );

  // 5. Memory addresses (0x7fff5fbff600)
  normalized = normalized.replace(/\b0x[0-9a-fA-F]{8,16}\b/g, '<HEX_ADDR>');

  // 6. Long hex strings (32+ hex chars: hashes, build IDs)
  normalized = normalized.replace(/\b[0-9a-fA-F]{32,64}\b/g, '<HASH>');

  // 7. Temporary / Runner directories
  // /tmp/... or /home/runner/work/... or /home/runner/_temp/...
  normalized = normalized.replace(
    /(?:\/home\/runner\/work\/|\/home\/runner\/_temp\/|\/tmp\/|\/var\/tmp\/)[^\s:'"]+/gi,
    '<TEMP_PATH>',
  );
  // Windows temp paths: C:\Users\RUNNER~1\AppData\Local\Temp\...
  normalized = normalized.replace(/[A-Za-z]:\\[^\s:'"]*?(?:Temp|tmp)[^\s:'"]*/gi, '<TEMP_PATH>');

  // 8. Process IDs: "pid 12345", "PID: 6789"
  normalized = normalized.replace(/\b(?:pid|process)\s*[:=]?\s*\d+\b/gi, 'pid <PID>');

  // 9. Git commit SHAs in explicit git/commit context
  normalized = normalized.replace(
    /\b(?:commit|revision)\s+[0-9a-fA-F]{7,40}\b/gi,
    'commit <COMMIT_SHA>',
  );

  return normalized;
}

/**
 * Transforms raw error line into canonical normalized string.
 */
export function canonicalizeErrorLine(
  rawErrorLine: string,
  customSecretPatterns: string[] = [],
): {
  redactedRawLine: string;
  normalizedErrorLine: string;
} {
  // Step 1: Secret Redaction
  const redactedRawLine = redactSecrets(rawErrorLine, customSecretPatterns);

  // Step 2: Strip ANSI
  const cleanLine = stripAnsi(redactedRawLine);

  // Step 3: Volatile-value normalization
  const normalizedVolatiles = normalizeVolatileValues(cleanLine);

  // Step 4: Canonical string formatting (normalize whitespace, trim, lowercase)
  const normalizedErrorLine = normalizedVolatiles.replace(/\s+/g, ' ').trim().toLowerCase();

  return {
    redactedRawLine,
    normalizedErrorLine,
  };
}

/**
 * Generates a full FailureFingerprint with SHA-256 hash.
 */
export function generateFingerprint(
  rawErrorLine: string,
  customSecretPatterns: string[] = [],
  fileLocation?: string,
): FailureFingerprint {
  const { redactedRawLine, normalizedErrorLine } = canonicalizeErrorLine(
    rawErrorLine,
    customSecretPatterns,
  );

  // Generate SHA-256 canonical hash
  const canonicalHash = createHash('sha256').update(normalizedErrorLine, 'utf-8').digest('hex');

  const fingerprint: FailureFingerprint = {
    canonicalHash,
    rawErrorLine: redactedRawLine,
    normalizedErrorLine,
  };

  if (fileLocation) {
    fingerprint.fileLocation = fileLocation;
  }

  return fingerprint;
}
