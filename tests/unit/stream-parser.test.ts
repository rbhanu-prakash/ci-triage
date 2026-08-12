import { describe, it, expect } from 'vitest';
import { StringLogStreamProvider } from '../../src/core/log-provider.js';
import { parseLogStream, StreamLogParser } from '../../src/parser/stream-parser.js';

describe('Bounded-Memory Log Stream Parser', () => {
  it('should parse a small log and detect single error signature', async () => {
    const logText = [
      '2026-08-12T10:00:00Z [INFO] Starting build job...',
      '2026-08-12T10:00:01Z [INFO] Installing dependencies...',
      '2026-08-12T10:00:05Z Error: ECONNREFUSED 127.0.0.1:8080',
      '2026-08-12T10:00:06Z [INFO] Job failed.',
    ].join('\n');

    const provider = new StringLogStreamProvider(logText);
    const result = await parseLogStream(provider);

    expect(result.totalLinesProcessed).toBe(4);
    expect(result.totalErrorsDetected).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.frames.length).toBe(1);
    expect(result.frames[0].rawErrorLine).toContain('Error: ECONNREFUSED 127.0.0.1:8080');
    expect(result.frames[0].normalizedErrorLine).toContain('error: econnrefused <ip>:<port>');
  });

  it('should detect errors located at beginning, middle, and end of a large log', async () => {
    const lines: string[] = [];
    lines.push('Error: Early initialization failure'); // line 0

    for (let i = 1; i <= 100; i++) {
      if (i === 50) {
        lines.push('2026-08-12T10:20:00Z Exception: NullPointerException at App.java:42');
      } else {
        lines.push(`[INFO] Processing step ${i}...`);
      }
    }
    lines.push('fatal: git clone failed'); // line 102

    const provider = new StringLogStreamProvider(lines.join('\n'));
    const result = await parseLogStream(provider, {}, { linesBefore: 2, linesAfter: 2 });

    expect(result.totalLinesProcessed).toBe(102);
    expect(result.totalErrorsDetected).toBe(3);
    expect(result.frames.length).toBe(3);
    expect(result.frames[0].errorLineIndex).toBe(0);
    expect(result.frames[1].errorLineIndex).toBe(50);
    expect(result.frames[2].errorLineIndex).toBe(101);
  });

  it('should enforce maxLogSizeBytes and truncate safely', async () => {
    // Generate 500 lines of log output
    const lines = Array.from(
      { length: 500 },
      (_, i) => `Line ${i}: info message text for testing...`,
    );
    const provider = new StringLogStreamProvider(lines.join('\n'));

    // Limit to 200 bytes max
    const parser = new StreamLogParser({ maxLogSizeBytes: 200 });
    const result = await parser.parse(provider);

    expect(result.truncated).toBe(true);
    expect(result.bytesProcessed).toBeLessThanOrEqual(250);
    expect(result.totalLinesProcessed).toBeLessThan(500);
  });

  it('should automatically redact secrets during log stream parsing', async () => {
    const classicToken = 'ghp_' + 'Z'.repeat(36);
    const logText = [
      '2026-08-12T10:00:00Z [INFO] Authenticating...',
      `2026-08-12T10:00:01Z Error: Authentication failed for token=${classicToken}`,
      '2026-08-12T10:00:02Z [INFO] Done.',
    ].join('\n');

    const provider = new StringLogStreamProvider(logText);
    const result = await parseLogStream(provider);

    expect(result.frames.length).toBe(1);
    expect(result.frames[0].rawErrorLine).not.toContain(classicToken);
    expect(result.frames[0].rawErrorLine).toContain('token=[REDACTED]');
  });

  it('should strip ANSI codes during log stream parsing', async () => {
    const ansiLog = [
      '\u001b[32m[INFO] Step start\u001b[0m',
      '\u001b[31mError: Build failed with exit code 1\u001b[0m',
    ].join('\n');

    const provider = new StringLogStreamProvider(ansiLog);
    const result = await parseLogStream(provider);

    expect(result.frames.length).toBe(1);
    expect(result.frames[0].rawErrorLine).toBe('Error: Build failed with exit code 1');
  });
});
