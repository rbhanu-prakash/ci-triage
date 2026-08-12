import { describe, it, expect } from 'vitest';
import {
  generateFingerprint,
  normalizeVolatileValues,
  stripAnsi,
} from '../../src/parser/fingerprint.js';

describe('Canonical Fingerprinting System', () => {
  it('should strip ANSI escape sequences', () => {
    const ansiColored = '\u001b[31mError:\u001b[0m Connection failed';
    const stripped = stripAnsi(ansiColored);
    expect(stripped).toBe('Error: Connection failed');
  });

  it('should normalize ISO timestamps and dates', () => {
    const line = '2026-08-12T10:21:44.123Z Error occurred at 10:21:44';
    const normalized = normalizeVolatileValues(line);
    expect(normalized).toBe('<TIMESTAMP> Error occurred at <TIMESTAMP>');
  });

  it('should normalize IP addresses and ports', () => {
    const line = 'Failed to connect to 10.20.4.8:443 and 192.168.1.50';
    const normalized = normalizeVolatileValues(line);
    expect(normalized).toBe('Failed to connect to <IP>:<PORT> and <IP>');
  });

  it('should normalize UUIDs and request IDs', () => {
    const line = 'Request req-a1b2c3d4e5f6 with UUID 123e4567-e89b-12d3-a456-426614174000 failed';
    const normalized = normalizeVolatileValues(line);
    expect(normalized).toBe('Request <REQ_ID> with UUID <UUID> failed');
  });

  it('should normalize temporary paths and PIDs', () => {
    const line = 'Worker pid 12345 crashed while writing to /tmp/build-abc123/out.log';
    const normalized = normalizeVolatileValues(line);
    expect(normalized).toBe('Worker pid <PID> crashed while writing to <TEMP_PATH>');
  });

  it('should produce IDENTICAL fingerprints for errors differing only in volatile entities (IPs/timestamps)', () => {
    const logLine1 = '2026-08-12T10:21:44Z Error: connect ETIMEDOUT 10.20.4.8:443';
    const logLine2 = '2026-08-12T10:22:51Z Error: connect ETIMEDOUT 10.91.7.22:443';

    const fp1 = generateFingerprint(logLine1);
    const fp2 = generateFingerprint(logLine2);

    expect(fp1.canonicalHash).toBe(fp2.canonicalHash);
    expect(fp1.normalizedErrorLine).toBe(fp2.normalizedErrorLine);
  });

  it('should preserve meaningful numeric differences in assertion failures', () => {
    const line1 = 'AssertionError: Expected 2 but received 5';
    const line2 = 'AssertionError: Expected 2 but received 7';

    const fp1 = generateFingerprint(line1);
    const fp2 = generateFingerprint(line2);

    expect(fp1.canonicalHash).not.toBe(fp2.canonicalHash);
    expect(fp1.normalizedErrorLine).toBe('assertionerror: expected 2 but received 5');
    expect(fp2.normalizedErrorLine).toBe('assertionerror: expected 2 but received 7');
  });

  it('should perform secret redaction BEFORE hashing', () => {
    const secretToken1 = 'ghp_' + 'X'.repeat(36);
    const secretToken2 = 'ghp_' + 'Y'.repeat(36);

    const line1 = `Fatal error authenticating with token=${secretToken1}`;
    const line2 = `Fatal error authenticating with token=${secretToken2}`;

    const fp1 = generateFingerprint(line1);
    const fp2 = generateFingerprint(line2);

    // Because tokens are redacted to [REDACTED] prior to normalization/hashing,
    // both lines produce the same canonical fingerprint and no secrets are in rawErrorLine!
    expect(fp1.rawErrorLine).not.toContain(secretToken1);
    expect(fp2.rawErrorLine).not.toContain(secretToken2);
    expect(fp1.canonicalHash).toBe(fp2.canonicalHash);
  });
});
