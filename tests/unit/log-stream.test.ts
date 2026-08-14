import { describe, it, expect } from 'vitest';
import { createChunkedLogStream, GitHubLogStreamProvider } from '../../src/github/log-stream.js';
import { parseLogStream } from '../../src/parser/stream-parser.js';
import { DEFAULT_ANALYSIS_CONFIG } from '../../src/core/classifier.js';

describe('Phase 5 GitHub Streaming Log Provider (log-stream.ts)', () => {
  async function collectLines(stream: AsyncIterable<string>): Promise<string[]> {
    const lines: string[] = [];
    for await (const line of stream) {
      lines.push(line);
    }
    return lines;
  }

  it('1. combines multiple chunks into correct lines', async () => {
    async function* makeChunks() {
      yield 'Line ';
      yield '1\nLine 2';
      yield '\nLine 3\n';
    }

    const lines = await collectLines(createChunkedLogStream(makeChunks()));
    expect(lines).toEqual(['Line 1', 'Line 2', 'Line 3']);
  });

  it('2. correctly handles CRLF across chunk boundaries', async () => {
    async function* makeChunks() {
      yield 'First line\r';
      yield '\nSecond line\r\nThird line\r\n';
    }

    const lines = await collectLines(createChunkedLogStream(makeChunks()));
    expect(lines).toEqual(['First line', 'Second line', 'Third line']);
  });

  it('3. preserves final line without trailing newline', async () => {
    async function* makeChunks() {
      yield 'Line A\n';
      yield 'Line B\n';
      yield 'Line C without newline';
    }

    const lines = await collectLines(createChunkedLogStream(makeChunks()));
    expect(lines).toEqual(['Line A', 'Line B', 'Line C without newline']);
  });

  it('4. handles standalone CR as newline', async () => {
    async function* makeChunks() {
      yield 'Progress 10%\rProgress 50%\rProgress 100%\nDone';
    }

    const lines = await collectLines(createChunkedLogStream(makeChunks()));
    expect(lines).toEqual(['Progress 10%', 'Progress 50%', 'Progress 100%', 'Done']);
  });

  it('5. handles UTF-8 multi-byte characters split across chunk boundaries', async () => {
    // 🚨 is 4 bytes in UTF-8: 0xF0, 0x9F, 0x9A, 0xA8
    const emojiBytes = Buffer.from('🚨 Failure detected in auth.ts\n');
    const chunk1 = emojiBytes.subarray(0, 2); // Split inside the 4-byte emoji
    const chunk2 = emojiBytes.subarray(2);

    async function* makeByteChunks() {
      yield chunk1;
      yield chunk2;
    }

    const lines = await collectLines(createChunkedLogStream(makeByteChunks()));
    expect(lines).toEqual(['🚨 Failure detected in auth.ts']);
  });

  it('6. processes large stream incrementally without creating one giant string', async () => {
    const totalLines = 10000;
    let chunksGenerated = 0;

    async function* makeLargeStream() {
      for (let i = 1; i <= totalLines; i++) {
        chunksGenerated++;
        yield `[2026-08-14T08:00:00Z] Step ${i}: processing item\n`;
      }
    }

    let lineCount = 0;
    for await (const line of createChunkedLogStream(makeLargeStream())) {
      lineCount++;
      expect(line).toContain('processing item');
    }

    expect(lineCount).toBe(totalLines);
    expect(chunksGenerated).toBe(totalLines);
  });

  it('7. integrates cleanly with Phase 2 StreamLogParser', async () => {
    async function* makeErrorChunks() {
      yield '2026-08-14T08:00:00Z [info] Starting test suite...\n';
      yield 'FAIL src/auth/login.test.ts\n';
      yield '  ✕ should authenticate user with valid credentials (45ms)\n';
      yield '    AssertionError: expected false to be true\n';
      yield '      at Object.<anonymous> (src/auth/login.test.ts:42:15)\n';
      yield 'Tests: 1 failed, 10 passed, 11 total\n';
    }

    const provider = new GitHubLogStreamProvider(() => makeErrorChunks(), 500);
    const estimatedSize = await provider.getEstimatedSizeBytes();
    expect(estimatedSize).toBe(500);

    const parseResult = await parseLogStream(provider, DEFAULT_ANALYSIS_CONFIG);
    expect(parseResult.frames.length).toBeGreaterThan(0);
    expect(parseResult.frames[0].rawErrorLine).toContain('FAIL src/auth/login.test.ts');
    expect(
      parseResult.frames[0].linesAfter.some((l) =>
        l.includes('AssertionError: expected false to be true'),
      ),
    ).toBe(true);
  });

  it('8. truncation remains bounded by Phase 2 maxLogSizeBytes configuration', async () => {
    async function* makeInfiniteChunks() {
      while (true) {
        yield 'A'.repeat(100) + '\n';
      }
    }

    const provider = new GitHubLogStreamProvider(() => makeInfiniteChunks());
    const parseResult = await parseLogStream(provider, {
      ...DEFAULT_ANALYSIS_CONFIG,
      maxLogSizeBytes: 1024, // 1KB limit
    });

    expect(parseResult.bytesProcessed).toBeLessThanOrEqual(1024 + 200);
    expect(parseResult.totalLinesProcessed).toBeGreaterThan(0);
  });
});
