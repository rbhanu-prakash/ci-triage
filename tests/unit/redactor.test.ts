import { describe, it, expect } from 'vitest';
import { Redactor, redactSecrets } from '../../src/security/redactor.js';

describe('Redactor (Secret Sanitization & Invariants)', () => {
  it('should redact GitHub Personal Access Tokens and enforce secret invariant', () => {
    const classicToken = 'ghp_' + 'A'.repeat(36);
    const fineGrainedToken =
      'github_pat_11AAAAAAA_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const oAuthToken = 'gho_' + 'B'.repeat(36);

    const raw = `Connecting with ${classicToken} and ${fineGrainedToken} and ${oAuthToken}`;
    const sanitized = redactSecrets(raw);

    // Secret Invariant: Secrets MUST NOT appear anywhere in the sanitized result
    expect(sanitized).not.toContain(classicToken);
    expect(sanitized).not.toContain(fineGrainedToken);
    expect(sanitized).not.toContain(oAuthToken);
    expect(sanitized).toBe('Connecting with [REDACTED] and [REDACTED] and [REDACTED]');
  });

  it('should redact Bearer and Basic authorization formats across header, query, and JSON contexts', () => {
    const bearerSecret1 = 'secret-bearer-token-12345';
    const bearerSecret2 = 'secret-bearer-token-67890';
    const bearerSecret3 = 'secret-bearer-token-abcde';
    const basicSecret1 = 'c2VjcmV0LXBhc3N3b3JkLTEyMw==';
    const basicSecret2 = 'c2VjcmV0LXBhc3N3b3JkLTQ1Ng==';
    const basicSecret3 = 'c2VjcmV0LXBhc3N3b3JkLTc4OQ==';

    const testCases = [
      { raw: `Authorization: Bearer ${bearerSecret1}`, secret: bearerSecret1 },
      { raw: `authorization=Bearer ${bearerSecret2}`, secret: bearerSecret2 },
      { raw: `"authorization": "Bearer ${bearerSecret3}"`, secret: bearerSecret3 },
      { raw: `Authorization: Basic ${basicSecret1}`, secret: basicSecret1 },
      { raw: `authorization=Basic ${basicSecret2}`, secret: basicSecret2 },
      { raw: `"authorization": "Basic ${basicSecret3}"`, secret: basicSecret3 },
    ];

    for (const { raw, secret } of testCases) {
      const sanitized = redactSecrets(raw);
      expect(sanitized).not.toContain(secret);
      expect(sanitized).toContain('[REDACTED]');
    }
  });

  it('should handle AWS Access Key IDs (positive and negative tests) and enforce secret invariant', () => {
    const validKey1 = 'AKIAIOSFODNN7EXAMPLE';
    const validKey2 = 'ASIAIOSFODNN7EXAMPLE';
    const validKey3 = 'AROA1234567890ABCDEF';

    const rawValid = `Keys: ${validKey1}, ${validKey2}, ${validKey3}`;
    const sanitizedValid = redactSecrets(rawValid);

    expect(sanitizedValid).not.toContain(validKey1);
    expect(sanitizedValid).not.toContain(validKey2);
    expect(sanitizedValid).not.toContain(validKey3);
    expect(sanitizedValid).toBe('Keys: [REDACTED], [REDACTED], [REDACTED]');

    // Negative tests: Invalid structures should not be false-positively redacted
    const tooShort = 'AKIA123';
    const tooLong = 'AKIAIOSFODNN7EXAMPLEEXTRA';
    const notWordBoundary = 'ordinary_word_AKIA';
    const lowercase = 'akiaiosfodnn7example';

    const rawInvalid = `${tooShort} ${tooLong} ${notWordBoundary} ${lowercase}`;
    const sanitizedInvalid = redactSecrets(rawInvalid);

    expect(sanitizedInvalid).toBe(rawInvalid);
  });

  it('should redact common API keys (OpenAI, Stripe, Slack)', () => {
    const openAi = 'sk-' + 'a'.repeat(24);
    const stripe = 'sk_live_' + 'b'.repeat(24);
    const slack = 'xoxb-1234567890-abcdefghij';

    const raw = `Keys: ${openAi}, ${stripe}, ${slack}`;
    const sanitized = redactSecrets(raw);

    expect(sanitized).not.toContain(openAi);
    expect(sanitized).not.toContain(stripe);
    expect(sanitized).not.toContain(slack);
    expect(sanitized).toBe('Keys: [REDACTED], [REDACTED], [REDACTED]');
  });

  it('should redact complete PEM private key blocks', () => {
    const keyData = 'MIIEowIBAAKCAQEA1234567890abc...';
    const completeKey = `-----BEGIN RSA PRIVATE KEY-----\n${keyData}\n-----END RSA PRIVATE KEY-----\nsome log output afterwards`;

    const sanitizedComplete = redactSecrets(`Error:\n${completeKey}`);
    expect(sanitizedComplete).not.toContain(keyData);
    expect(sanitizedComplete).toContain('[REDACTED_PRIVATE_KEY]');
    expect(sanitizedComplete).toContain('some log output afterwards');
  });

  it('should redact unmatched BEGIN markers through the end of input (<2048 chars) and leave no key material', () => {
    const keyMaterial = 'X'.repeat(500);
    const logPrefix = 'Log header line\n';
    const raw = `${logPrefix}-----BEGIN OPENSSH PRIVATE KEY-----\n${keyMaterial}`;

    const sanitized = redactSecrets(raw);

    expect(sanitized).toContain('Log header line');
    expect(sanitized).not.toContain(keyMaterial);
    expect(sanitized).not.toContain('XXXXX');
    expect(sanitized).toBe(`${logPrefix}[REDACTED_PRIVATE_KEY]`);
  });

  it('should redact unmatched BEGIN markers through the end of input (>2048 chars) and leave no key material', () => {
    const keyMaterial = 'Y'.repeat(3000);
    const logPrefix = 'Log header line\n';
    const raw = `${logPrefix}-----BEGIN PRIVATE KEY-----\n${keyMaterial}`;

    const sanitized = redactSecrets(raw);

    expect(sanitized).toContain('Log header line');
    expect(sanitized).not.toContain(keyMaterial);
    expect(sanitized).not.toContain('YYYYY');
    expect(sanitized).toBe(`${logPrefix}[REDACTED_PRIVATE_KEY]`);
  });

  it('should redact all token assignment quoting variants and enforce secret invariant', () => {
    const s1 = 'SECRET_ASSIGN_1';
    const s2 = 'SECRET_ASSIGN_2';
    const s3 = 'SECRET_ASSIGN_3';
    const s4 = 'SECRET_ASSIGN_4';
    const s5 = 'SECRET_ASSIGN_5';
    const s6 = 'SECRET_ASSIGN_6';

    const assignments = [
      { raw: `token=${s1}`, secret: s1 },
      { raw: `token="${s2}"`, secret: s2 },
      { raw: `token='${s3}'`, secret: s3 },
      { raw: `"token": "${s4}"`, secret: s4 },
      { raw: `TOKEN=${s5}`, secret: s5 },
      { raw: `export TOKEN=${s6}`, secret: s6 },
    ];

    for (const { raw, secret } of assignments) {
      const sanitized = redactSecrets(raw);
      expect(sanitized).not.toContain(secret);
      expect(sanitized).toContain('[REDACTED]');
    }
  });

  it('should redact secrets embedded in URLs', () => {
    const pass = 'myPass123';
    const apiKey = 'secretKey123';
    const rawUrl1 = `https://admin:${pass}@github.com/my-org/repo.git`;
    const rawUrl2 = `https://api.service.com/data?api_key=${apiKey}&format=json`;

    const sanitized1 = redactSecrets(rawUrl1);
    const sanitized2 = redactSecrets(rawUrl2);

    expect(sanitized1).not.toContain(pass);
    expect(sanitized1).toBe('https://admin:[REDACTED]@github.com/my-org/repo.git');

    expect(sanitized2).not.toContain(apiKey);
    expect(sanitized2).toBe('https://api.service.com/data?api_key=[REDACTED]&format=json');
  });

  it('should support user-provided custom secret patterns', () => {
    const secret = 'CUSTOM_SECRET_987654';
    const customPattern = 'CUSTOM_SECRET_\\d+';
    const redactor = new Redactor([customPattern]);

    const raw = `Found credential ${secret} in configuration`;
    const sanitized = redactor.redact(raw);

    expect(sanitized).not.toContain(secret);
    expect(sanitized).toBe('Found credential [REDACTED] in configuration');
  });

  it('should handle multiple different secrets in a single log line', () => {
    const pass = 'p12345';
    const awsKey = 'AKIAIOSFODNN7EXAMPLE';
    const classicToken = 'ghp_' + 'C'.repeat(36);
    const raw = `password=${pass} AWS_ACCESS_KEY_ID=${awsKey} token=${classicToken}`;

    const sanitized = redactSecrets(raw);

    expect(sanitized).not.toContain(pass);
    expect(sanitized).not.toContain(awsKey);
    expect(sanitized).not.toContain(classicToken);
  });

  it('should NOT over-redact ordinary words when no secret value is assigned', () => {
    const line1 = 'Entering password verification stage';
    const line2 = 'Invalid token format in header';
    const line3 = 'API key parameter is required';

    expect(redactSecrets(line1)).toBe('Entering password verification stage');
    expect(redactSecrets(line2)).toBe('Invalid token format in header');
    expect(redactSecrets(line3)).toBe('API key parameter is required');
  });
});
