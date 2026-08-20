import { describe, it, expect } from 'vitest';
import {
  StringLogStreamProvider,
  IncrementalArrayLogStreamProvider,
  createIncrementalLogProvider,
} from '../../src/core/log-provider.js';
import { parseLogStream, StreamLogParser } from '../../src/parser/stream-parser.js';
import { isErrorSignature } from '../../src/parser/error-patterns.js';

describe('Bounded-Memory Log Stream Parser', () => {
  it('should parse a small log and detect single error signature (StringLogStreamProvider)', async () => {
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

  it('should parse incrementally using IncrementalArrayLogStreamProvider without full string materialization', async () => {
    const lineArray = [
      '2026-08-12T10:00:00Z [INFO] Step 1 initializing...',
      '2026-08-12T10:00:01Z [INFO] Step 2 compiling...',
      '2026-08-12T10:00:02Z Error: Build failed with syntax error at main.ts:15',
      '2026-08-12T10:00:03Z [INFO] Step 3 teardown.',
    ];

    const provider = createIncrementalLogProvider(lineArray);
    const result = await parseLogStream(provider);

    expect(result.totalLinesProcessed).toBe(4);
    expect(result.totalErrorsDetected).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.frames.length).toBe(1);
    expect(result.frames[0].rawErrorLine).toContain('Error: Build failed with syntax error');
  });

  it('should parse thousands of lines incrementally via AsyncGenerator without unbounded buffering', async () => {
    async function* generateManyLines(): AsyncGenerator<string> {
      yield '[INFO] Start job stream';
      for (let i = 1; i <= 5000; i++) {
        if (i === 2500) {
          yield `2026-08-12T10:30:00Z Exception: OutOfMemoryError in worker task ${i}`;
        } else {
          yield '[INFO] Normal execution step ok';
        }
      }
      yield '[INFO] End job stream';
    }

    const provider = new IncrementalArrayLogStreamProvider(generateManyLines);
    const parser = new StreamLogParser({ maxLogSizeBytes: 10 * 1024 * 1024 });
    const result = await parser.parse(provider);

    expect(result.totalLinesProcessed).toBe(5002);
    expect(result.totalErrorsDetected).toBe(1);
    expect(result.frames.length).toBe(1);
    expect(result.frames[0].errorLineIndex).toBe(2500);
    expect(result.frames[0].rawErrorLine).toContain(
      'Exception: OutOfMemoryError in worker task 2500',
    );
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

    const provider = createIncrementalLogProvider(lines);
    const result = await parseLogStream(provider, {}, { linesBefore: 2, linesAfter: 2 });

    expect(result.totalLinesProcessed).toBe(102);
    expect(result.totalErrorsDetected).toBe(3);
    expect(result.frames.length).toBe(3);
    expect(result.frames[0].errorLineIndex).toBe(0);
    expect(result.frames[1].errorLineIndex).toBe(50);
    expect(result.frames[2].errorLineIndex).toBe(101);
  });

  it('should enforce maxLogSizeBytes and truncate safely on incremental provider', async () => {
    const lines = Array.from(
      { length: 500 },
      (_, i) => `Line ${i}: info message text for testing...`,
    );
    const provider = createIncrementalLogProvider(lines);

    // Limit to 200 bytes max
    const parser = new StreamLogParser({ maxLogSizeBytes: 200 });
    const result = await parser.parse(provider);

    expect(result.truncated).toBe(true);
    expect(result.bytesProcessed).toBeLessThanOrEqual(250);
    expect(result.totalLinesProcessed).toBeLessThan(500);
  });

  it('should bound retained context for exceptionally large individual lines while accurately tracking maxLogSizeBytes', async () => {
    const hugeLinePadding = 'A'.repeat(50000);
    const hugeErrorLine = `Error: System crash context ${hugeLinePadding}`;

    const lines = ['[INFO] Starting step...', hugeErrorLine, '[INFO] Finishing step...'];

    const provider = createIncrementalLogProvider(lines);
    const parser = new StreamLogParser({
      maxLogSizeBytes: 100000,
      maxLineLength: 100, // Bound individual line length in context frame to 100 chars
    });

    const result = await parser.parse(provider);

    expect(result.totalLinesProcessed).toBe(3);
    expect(result.totalErrorsDetected).toBe(1);
    expect(result.bytesProcessed).toBeGreaterThan(50000); // Full byte length accurately counted
    expect(result.frames.length).toBe(1);
    expect(result.frames[0].rawErrorLine.length).toBeLessThanOrEqual(120); // 100 chars + '... [truncated]'
    expect(result.frames[0].rawErrorLine).toContain('... [truncated]');
  });

  it('should enforce maxFrames cap to keep retained context frames bounded', async () => {
    async function* generateManyErrors(): AsyncGenerator<string> {
      for (let i = 0; i < 100; i++) {
        yield `Error: Failure event #${i}`;
      }
    }

    const provider = createIncrementalLogProvider(generateManyErrors);
    const parser = new StreamLogParser({
      contextConfig: { maxFrames: 10, linesBefore: 0, linesAfter: 0 },
    });

    const result = await parser.parse(provider);

    expect(result.totalErrorsDetected).toBe(100);
    expect(result.frames.length).toBe(10); // Strictly capped at maxFrames
  });

  it('should automatically redact secrets during log stream parsing', async () => {
    const classicToken = 'ghp_' + 'Z'.repeat(36);
    const logText = [
      '2026-08-12T10:00:00Z [INFO] Authenticating...',
      `2026-08-12T10:00:01Z Error: Authentication failed for token=${classicToken}`,
      '2026-08-12T10:00:02Z [INFO] Done.',
    ];

    const provider = createIncrementalLogProvider(logText);
    const result = await parseLogStream(provider);

    expect(result.frames.length).toBe(1);
    expect(result.frames[0].rawErrorLine).not.toContain(classicToken);
    expect(result.frames[0].rawErrorLine).toContain('token=[REDACTED]');
  });

  it('should strip ANSI codes during log stream parsing', async () => {
    const ansiLog = [
      '\u001b[32m[INFO] Step start\u001b[0m',
      '\u001b[31mError: Build failed with exit code 1\u001b[0m',
    ];

    const provider = createIncrementalLogProvider(ansiLog);
    const result = await parseLogStream(provider);

    expect(result.frames.length).toBe(1);
    expect(result.frames[0].rawErrorLine).toBe('Error: Build failed with exit code 1');
  });

  it('should allow calling getEstimatedSizeBytes before parse without exhausting a one-shot AsyncGenerator stream', async () => {
    let generatorCalled = false;

    // One-shot AsyncGenerator function
    async function* oneShotStream(): AsyncGenerator<string> {
      if (generatorCalled) {
        throw new Error('One-shot generator function was invoked multiple times');
      }
      generatorCalled = true;

      yield '2026-08-12T10:00:00Z [INFO] Line 1';
      yield '2026-08-12T10:00:01Z Error: Failure in step 2';
      yield '2026-08-12T10:00:02Z [INFO] Line 3';
    }

    const provider = new IncrementalArrayLogStreamProvider(oneShotStream);

    // Call getEstimatedSizeBytes first
    const sizeEstimate = await provider.getEstimatedSizeBytes();
    expect(sizeEstimate).toBeUndefined(); // Should return undefined without calling/consuming the generator

    // Next parse the log stream
    const parser = new StreamLogParser();
    const result = await parser.parse(provider);

    expect(result.totalLinesProcessed).toBe(3);
    expect(result.totalErrorsDetected).toBe(1);
    expect(result.frames[0].rawErrorLine).toContain('Error: Failure in step 2');
  });

  describe('Error Signature Detection (isErrorSignature)', () => {
    it('A. curl: (7) Failed to connect ... -> true', () => {
      expect(
        isErrorSignature(
          "curl: (7) Failed to connect to 127.0.0.1 port 9 after 0 ms: Couldn't connect to server",
        ),
      ).toBe(true);
    });

    it("B. Couldn't connect to server -> true", () => {
      expect(isErrorSignature("Couldn't connect to server")).toBe(true);
      expect(isErrorSignature('Could not connect to server')).toBe(true);
      expect(isErrorSignature('Failed to connect to backend')).toBe(true);
      expect(isErrorSignature('connection refused on port 9000')).toBe(true);
      expect(isErrorSignature('connection reset by peer')).toBe(true);
      expect(isErrorSignature('network is unreachable')).toBe(true);
    });

    it('C. ordinary text containing "server" -> false', () => {
      expect(isErrorSignature('Starting development server on port 3000')).toBe(false);
      expect(isErrorSignature('Connected to server successfully')).toBe(false);
      expect(isErrorSignature('Server listening at http://localhost:8080')).toBe(false);
    });

    it('D. ordinary text containing "failed" -> false', () => {
      expect(isErrorSignature('Checking if any previously failed steps should run')).toBe(false);
      expect(isErrorSignature('The step might have failed before recovery')).toBe(false);
      expect(isErrorSignature('Retrying failed request')).toBe(false);
    });
  });
});
