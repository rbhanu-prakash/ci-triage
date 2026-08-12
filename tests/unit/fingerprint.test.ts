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

  it('should normalize IPv4, IPv6 (full, compressed, bracketed), and preserve non-IP colon-separated text', () => {
    const ipv4Line = 'Failed to connect to 10.20.4.8:443 and 192.168.1.50';
    expect(normalizeVolatileValues(ipv4Line)).toBe('Failed to connect to <IP>:<PORT> and <IP>');

    const ipv6Compressed1 = 'Connect failed to ::1';
    expect(normalizeVolatileValues(ipv6Compressed1)).toBe('Connect failed to <IP>');

    const ipv6Compressed2 = 'Host 2001:db8::1 unreachable';
    expect(normalizeVolatileValues(ipv6Compressed2)).toBe('Host <IP> unreachable');

    const ipv6Compressed3 = 'Link fe80::1 down';
    expect(normalizeVolatileValues(ipv6Compressed3)).toBe('Link <IP> down');

    const ipv6Bracketed = 'Binding [2001:db8::1]:8080 and [::1]';
    expect(normalizeVolatileValues(ipv6Bracketed)).toBe('Binding <IP>:<PORT> and <IP>');

    // Non-IP colon-separated text must NOT be destroyed
    const nonIpText = 'Error: step: build failed at main (file.js:12:34)';
    expect(normalizeVolatileValues(nonIpText)).toBe(nonIpText);
  });

  it('should normalize hashes only when contextual evidence exists and preserve arbitrary long hex IDs', () => {
    // 1. Contextual hash -> normalized
    const contextualHashes = [
      'sha256: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      'sha1: 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
      'hash=a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
      'digest=a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
      'checksum=a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
      'build hash a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    ];

    for (const line of contextualHashes) {
      const normalized = normalizeVolatileValues(line);
      expect(normalized).toContain('<HASH>');
      expect(normalized).not.toContain('a1b2c3d4e5f6');
    }

    // 2. Arbitrary long hex error identifier -> preserved
    const arbitraryHexLine1 =
      'Error ERR_E3F1A2B3C4D5E6F7A8B9C0D1E2F3A4B5: transaction state mismatch';
    const arbitraryHexLine2 =
      'Error ERR_9999A2B3C4D5E6F7A8B9C0D1E2F3A4B5: transaction state mismatch';

    const normalized1 = normalizeVolatileValues(arbitraryHexLine1);
    const normalized2 = normalizeVolatileValues(arbitraryHexLine2);

    expect(normalized1).toBe(arbitraryHexLine1);
    expect(normalized2).toBe(arbitraryHexLine2);

    const fp1 = generateFingerprint(arbitraryHexLine1);
    const fp2 = generateFingerprint(arbitraryHexLine2);
    expect(fp1.canonicalHash).not.toBe(fp2.canonicalHash);

    // 3. Meaningful numeric assertions remain unchanged
    const assertion1 = 'AssertionError: Expected 2 but received 5';
    const assertion2 = 'AssertionError: Expected 2 but received 7';
    expect(normalizeVolatileValues(assertion1)).toBe(assertion1);
    expect(normalizeVolatileValues(assertion2)).toBe(assertion2);

    // 4. Existing commit/revision normalization still works
    const commitLine = 'Deployed commit 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b successfully';
    const revisionLine = 'Deployed revision: 1a2b3c4 successfully';

    expect(normalizeVolatileValues(commitLine)).toBe('Deployed commit <COMMIT_SHA> successfully');
    expect(normalizeVolatileValues(revisionLine)).toBe('Deployed commit <COMMIT_SHA> successfully');
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
