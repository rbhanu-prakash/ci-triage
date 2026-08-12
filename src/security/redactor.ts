/**
 * Security Layer: Secret Redaction
 *
 * Deterministic, platform-agnostic secret sanitizer.
 * Sanitizes sensitive credentials BEFORE any log excerpt can become an
 * EvidenceItem, fingerprint input, or report output.
 */

export class Redactor {
  private customRegexes: RegExp[] = [];

  constructor(customPatterns: string[] = []) {
    for (const pattern of customPatterns) {
      if (!pattern || pattern.trim() === '') continue;
      try {
        this.customRegexes.push(new RegExp(pattern, 'g'));
      } catch {
        // Safely ignore invalid user-provided regex patterns
      }
    }
  }

  /**
   * Redacts sensitive information from log line or text block.
   */
  public redact(text: string): string {
    if (!text) return text;

    let sanitized = text;

    // 1. Private SSH / PGP Keys
    sanitized = sanitized.replace(
      /-----BEGIN (?:RSA|OPENSSH|DSA|EC|PGP) PRIVATE KEY-----[\s\S]*?-----END (?:RSA|OPENSSH|DSA|EC|PGP) PRIVATE KEY-----/g,
      '[REDACTED_PRIVATE_KEY]',
    );
    sanitized = sanitized.replace(
      /-----BEGIN [A-Z ]+ PRIVATE KEY-----[^\r\n]*/g,
      '[REDACTED_PRIVATE_KEY]',
    );

    // 2. GitHub Tokens
    // Fine-grained PAT: github_pat_...
    sanitized = sanitized.replace(/\bgithub_pat_[a-zA-Z0-9_]{30,255}\b/g, '[REDACTED]');
    // Classic PAT / OAuth / Server / Refresh tokens: ghp_, gho_, ghu_, ghs_, ghr_
    sanitized = sanitized.replace(/\b(ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36,255}\b/g, '[REDACTED]');

    // 3. AWS Credentials
    // Access Key ID
    sanitized = sanitized.replace(
      /\b(A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/g,
      '[REDACTED]',
    );

    // 4. Common API Key formats (OpenAI, Stripe, Slack, Square, etc.)
    sanitized = sanitized.replace(/\bsk-[a-zA-Z0-9]{20,}\b/g, '[REDACTED]');
    sanitized = sanitized.replace(/\bsk_live_[a-zA-Z0-9]{24,}\b/g, '[REDACTED]');
    sanitized = sanitized.replace(/\bxox[baprs]-[a-zA-Z0-9\-]{10,}\b/g, '[REDACTED]');

    // 5. Bearer Tokens
    sanitized = sanitized.replace(/\b(Bearer\s+)[a-zA-Z0-9\-._~+/]+=*/gi, '$1[REDACTED]');

    // 6. Secrets embedded in URLs
    // User:pass in URL authority: http://user:secret@host/path
    sanitized = sanitized.replace(/(https?:\/\/)([^:\s\/]+):([^@\s\/]+)@/g, '$1$2:[REDACTED]@');
    // Query parameters: ?token=xyz, &api_key=xyz, &password=xyz
    sanitized = sanitized.replace(
      /([?&](?:access_token|auth_token|token|api_key|apikey|secret|password|passwd|key)=)([^&\s"']+)/gi,
      '$1[REDACTED]',
    );

    // 7. Credential key-value / JSON / Environment variable assignments
    // Matches key=value, key: value, "key": "value"
    sanitized = sanitized.replace(
      /\b(password|passwd|pass|token|secret|api[_-]?key|access[_-]?token|auth[_-]?token|authorization|private[_-]?key|client[_-]?secret|app[_-]?secret|aws[_-]?secret[_-]?access[_-]?key)\b(\s*[:=]\s*)(["']?)([^"'\s;,\r\n&?]+)\3/gi,
      (match, key: string, sep: string, quote: string, val: string) => {
        // Do not over-redact placeholders or already redacted values
        const lowerVal = val.toLowerCase();
        if (
          val === '[REDACTED]' ||
          val === '[REDACTED_PRIVATE_KEY]' ||
          lowerVal === 'null' ||
          lowerVal === 'undefined' ||
          lowerVal === 'true' ||
          lowerVal === 'false' ||
          val === '***' ||
          val === ''
        ) {
          return match;
        }
        if (key.toLowerCase() === 'authorization') {
          if (
            lowerVal === '[redacted]' ||
            lowerVal.startsWith('bearer [redacted]') ||
            lowerVal === 'bearer'
          ) {
            return match;
          }
          if (lowerVal.startsWith('bearer')) {
            return `${key}${sep}${quote}Bearer [REDACTED]${quote}`;
          }
        }
        return `${key}${sep}${quote}[REDACTED]${quote}`;
      },
    );

    // 8. Custom user patterns
    for (const regex of this.customRegexes) {
      sanitized = sanitized.replace(regex, '[REDACTED]');
    }

    return sanitized;
  }
}

export function redactSecrets(text: string, customPatterns: string[] = []): string {
  return new Redactor(customPatterns).redact(text);
}
