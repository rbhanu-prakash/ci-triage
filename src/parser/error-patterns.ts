/**
 * Parser Layer: Error Signature Detection
 *
 * Provides conservative pattern matching for candidate failure lines in CI logs.
 */

export const DEFAULT_ERROR_SIGNATURES: string[] = [
  'ERROR:',
  'Error:',
  'error:',
  'error TS',
  'npm ERR!',
  'yarn error',
  'pip error',
  'FAIL',
  'FAILED',
  'FAILURE',
  'Exception:',
  'Traceback',
  'panic:',
  'fatal:',
  'exit code',
  'exited with code',
  'command failed',
  'assertion failure',
  'test failed',
  'segmentation fault',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EACCES',
  'ENOSPC',
  'out of memory',
  'heap out of memory',
  '403',
  '429',
  '500',
  '502',
  '503',
  '504',
  '×',
  'yaml:',
  'undefined:',
  'curl: (7)',
  'Failed to connect to',
  "Couldn't connect to server",
  'Could not connect to server',
  'connection refused',
  'connection reset',
  'network is unreachable',
];

/**
 * Checks if a sanitized log line matches candidate error/failure patterns.
 */
export function isErrorSignature(line: string, customSignatures?: string[]): boolean {
  if (!line || line.trim() === '') return false;

  const signatures = customSignatures || DEFAULT_ERROR_SIGNATURES;

  for (const sig of signatures) {
    // 1. All-uppercase keyword (FAIL, FAILED, FAILURE) -> match word boundary
    if (/^[A-Z]{3,7}$/.test(sig)) {
      const regex = new RegExp(`\\b${sig}\\b`);
      if (regex.test(line)) return true;
    }
    // 2. HTTP Status codes (403, 500, etc.) -> match word boundary
    else if (/^\d{3}$/.test(sig)) {
      const regex = new RegExp(`\\b${sig}\\b`);
      if (regex.test(line)) return true;
    }
    // 3. Substring / phrase match
    else {
      if (line.includes(sig) || line.toLowerCase().includes(sig.toLowerCase())) {
        return true;
      }
    }
  }

  return false;
}
