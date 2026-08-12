/**
 * Security Layer: Secret Redaction
 *
 * Deterministic, platform-agnostic secret sanitizer.
 * Sanitizes sensitive credentials BEFORE any log excerpt can become an
 * EvidenceItem, fingerprint input, or report output.
 */

export class Redactor {
  private customRegexes: RegExp[] = [];

  /**
   * Constructs a Redactor instance.
   *
   * Note on Custom Regex Patterns:
   * User-provided regular expressions are treated as trusted configuration.
   * Callers should ensure patterns are well-formed to avoid performance or
   * catastrophic backtracking (ReDoS) implications during log parsing.
   */
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

    // 1. Private SSH / PGP / TLS Keys
    // Complete PEM private key blocks are redacted as a single complete block
    sanitized = sanitized.replace(
      /-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9_-]+ )?PRIVATE KEY-----/gi,
      '[REDACTED_PRIVATE_KEY]',
    );
    // Unmatched BEGIN marker fallback: fail safely by redacting a bounded safety region (up to 2048 chars)
    sanitized = sanitized.replace(
      /-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----[\s\S]{0,2048}/gi,
      '[REDACTED_PRIVATE_KEY]',
    );

    // 2. GitHub Tokens
    // Fine-grained PAT: github_pat_...
    sanitized = sanitized.replace(/\bgithub_pat_[a-zA-Z0-9_]{30,255}\b/g, '[REDACTED]');
    // Classic PAT / OAuth / Server / Refresh tokens: ghp_, gho_, ghu_, ghs_, ghr_
    sanitized = sanitized.replace(/\b(ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36,255}\b/g, '[REDACTED]');

    // 3. AWS Credentials
    // Access Key ID: Exactly 20 uppercase alphanumeric chars starting with standard AWS prefixes
    sanitized = sanitized.replace(
      /\b(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/g,
      '[REDACTED]',
    );

    // 4. Common API Key formats (OpenAI, Stripe, Slack, Square, etc.)
    sanitized = sanitized.replace(/\bsk-[a-zA-Z0-9]{20,}\b/g, '[REDACTED]');
    sanitized = sanitized.replace(/\bsk_live_[a-zA-Z0-9]{24,}\b/g, '[REDACTED]');
    sanitized = sanitized.replace(/\bxox[baprs]-[a-zA-Z0-9\-]{10,}\b/g, '[REDACTED]');

    // 5. Bearer & Basic Tokens
    sanitized = sanitized.replace(/\b((?:Bearer|Basic)\s+)[a-zA-Z0-9\-._~+/]+=*/gi, '$1[REDACTED]');

    // 6. Secrets embedded in URLs
    // User:pass in URL authority: http://user:secret@host/path
    sanitized = sanitized.replace(/(https?:\/\/)([^:\s\/]+):([^@\s\/]+)@/g, '$1$2:[REDACTED]@');
    // Query parameters: ?token=xyz, &api_key=xyz, &password=xyz
    sanitized = sanitized.replace(
      /([?&](?:access_token|auth_token|token|api_key|apikey|secret|password|passwd|key)=)([^&\s"']+)/gi,
      '$1[REDACTED]',
    );

    // 7. Credential key-value / JSON / Environment variable assignments
    // Matches key=value, key: value, "key": "value", token='value'
    sanitized = sanitized.replace(
      /(["']?)\b(password|passwd|pass|token|secret|api[_-]?key|access[_-]?token|auth[_-]?token|authorization|private[_-]?key|client[_-]?secret|app[_-]?secret|aws[_-]?secret[_-]?access[_-]?key)\b\1(\s*[:=]\s*)(?:(["'])(.*?)\4|([^"'\s;,\r\n&?]+))/gi,
      (
        match: string,
        keyQuote: string | undefined,
        key: string,
        sep: string,
        valQuote: string | undefined,
        quotedVal: string | undefined,
        unquotedVal: string | undefined,
      ) => {
        const kQuote = keyQuote || '';
        const vQuote = valQuote || '';
        const val = quotedVal !== undefined ? quotedVal : unquotedVal || '';

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
            lowerVal.startsWith('basic [redacted]') ||
            lowerVal === 'bearer' ||
            lowerVal === 'basic'
          ) {
            return match;
          }
          if (lowerVal.startsWith('bearer')) {
            return `${kQuote}${key}${kQuote}${sep}${vQuote}Bearer [REDACTED]${vQuote}`;
          }
          if (lowerVal.startsWith('basic')) {
            return `${kQuote}${key}${kQuote}${sep}${vQuote}Basic [REDACTED]${vQuote}`;
          }
        }
        return `${kQuote}${key}${kQuote}${sep}${vQuote}[REDACTED]${vQuote}`;
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
