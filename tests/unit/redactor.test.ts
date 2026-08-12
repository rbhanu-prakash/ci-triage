import { describe, it, expect } from 'vitest';
import { Redactor, redactSecrets } from '../../src/security/redactor.js';

describe('Redactor (Secret Sanitization)', () => {
  it('should redact GitHub Personal Access Tokens (classic and fine-grained)', () => {
    const classicToken = 'ghp_' + 'A'.repeat(36);
    const fineGrainedToken =
      'github_pat_11AAAAAAA_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const oAuthToken = 'gho_' + 'B'.repeat(36);

    const raw = `Connecting with ${classicToken} and ${fineGrainedToken} and ${oAuthToken}`;
    const sanitized = redactSecrets(raw);

    expect(sanitized).not.toContain(classicToken);
    expect(sanitized).not.toContain(fineGrainedToken);
    expect(sanitized).not.toContain(oAuthToken);
    expect(sanitized).toBe('Connecting with [REDACTED] and [REDACTED] and [REDACTED]');
  });

  it('should redact Bearer tokens', () => {
    const raw = 'Authorization: Bearer secret-bearer-token-12345==';
    const sanitized = redactSecrets(raw);

    expect(sanitized).not.toContain('secret-bearer-token-12345==');
    expect(sanitized).toBe('Authorization: Bearer [REDACTED]');
  });

  it('should redact AWS Access Key IDs', () => {
    const awsKey = 'AKIAIOSFODNN7EXAMPLE';
    const raw = `AWS_ACCESS_KEY_ID=${awsKey} initialized`;
    const sanitized = redactSecrets(raw);

    expect(sanitized).not.toContain(awsKey);
    expect(sanitized).toContain('[REDACTED]');
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

  it('should redact Private SSH / PGP key blocks', () => {
    const privateKey = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA1234567890abc...
-----END RSA PRIVATE KEY-----`;

    const raw = `Deployment error using key:\n${privateKey}`;
    const sanitized = redactSecrets(raw);

    expect(sanitized).not.toContain('MIIEowIBAAKCAQEA1234567890abc');
    expect(sanitized).toContain('[REDACTED_PRIVATE_KEY]');
  });

  it('should redact password, token, secret, and api_key assignments', () => {
    const raw =
      'password=superSecret123 token: "myToken456" secret: \'mySecret789\' api_key=key999';
    const sanitized = redactSecrets(raw);

    expect(sanitized).not.toContain('superSecret123');
    expect(sanitized).not.toContain('myToken456');
    expect(sanitized).not.toContain('mySecret789');
    expect(sanitized).not.toContain('key999');
    expect(sanitized).toBe(
      'password=[REDACTED] token: "[REDACTED]" secret: \'[REDACTED]\' api_key=[REDACTED]',
    );
  });

  it('should redact secrets embedded in URLs', () => {
    const rawUrl1 = 'https://admin:myPass123@github.com/my-org/repo.git';
    const rawUrl2 = 'https://api.service.com/data?api_key=secretKey123&format=json';

    const sanitized1 = redactSecrets(rawUrl1);
    const sanitized2 = redactSecrets(rawUrl2);

    expect(sanitized1).not.toContain('myPass123');
    expect(sanitized1).toBe('https://admin:[REDACTED]@github.com/my-org/repo.git');

    expect(sanitized2).not.toContain('secretKey123');
    expect(sanitized2).toBe('https://api.service.com/data?api_key=[REDACTED]&format=json');
  });

  it('should support user-provided custom secret patterns', () => {
    const customPattern = 'CUSTOM_SECRET_\\d+';
    const redactor = new Redactor([customPattern]);

    const raw = 'Found credential CUSTOM_SECRET_987654 in configuration';
    const sanitized = redactor.redact(raw);

    expect(sanitized).not.toContain('CUSTOM_SECRET_987654');
    expect(sanitized).toBe('Found credential [REDACTED] in configuration');
  });

  it('should handle multiple different secrets in a single log line', () => {
    const classicToken = 'ghp_' + 'C'.repeat(36);
    const raw = `password=p12345 AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE token=${classicToken}`;

    const sanitized = redactSecrets(raw);

    expect(sanitized).not.toContain('p12345');
    expect(sanitized).not.toContain('AKIAIOSFODNN7EXAMPLE');
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
