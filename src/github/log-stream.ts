import { StringDecoder } from 'node:string_decoder';
import { LogStreamProvider } from '../core/types.js';

export interface ChunkedLogStreamOptions {
  /**
   * Maximum characters allowed in an individual raw line buffer before truncating
   * and discarding remainder until next newline. Default: 65,536 (64KB).
   */
  maxLineBufferLength?: number;
}

/**
 * Creates an AsyncIterable<string> that incrementally processes chunks of data (Uint8Array, Buffer, or string),
 * properly handles UTF-8 multi-byte characters split across chunk boundaries, splits lines on \n, \r\n, or standalone \r,
 * strictly bounds the raw line buffer to avoid unbounded memory growth on giant lines without newlines,
 * and yields lines without buffering the entire stream into memory.
 */
export async function* createChunkedLogStream(
  chunks: AsyncIterable<Uint8Array | Buffer | string>,
  options: ChunkedLogStreamOptions = {},
): AsyncIterable<string> {
  const maxLineBufferLength = options.maxLineBufferLength ?? 64 * 1024;
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let discardingCurrentLine = false;

  for await (const rawChunk of chunks) {
    const chunkStr =
      typeof rawChunk === 'string'
        ? rawChunk
        : decoder.write(Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk));

    if (!chunkStr) continue;

    buffer += chunkStr;

    let searchIndex = 0;
    while (searchIndex < buffer.length) {
      const crIndex = buffer.indexOf('\r', searchIndex);
      const lfIndex = buffer.indexOf('\n', searchIndex);

      if (crIndex === -1 && lfIndex === -1) {
        // No newline found in the current buffer
        if (buffer.length > maxLineBufferLength) {
          if (!discardingCurrentLine) {
            // Emit bounded line representation and flag that we are discarding the remainder
            yield buffer.slice(0, maxLineBufferLength);
            discardingCurrentLine = true;
          }
          // Discard accumulated buffer
          buffer = '';
        }
        break;
      }

      if (crIndex !== -1 && (lfIndex === -1 || crIndex < lfIndex)) {
        // \r appears first
        if (crIndex === buffer.length - 1) {
          // \r is at the very end of current buffer; wait for next chunk in case it is \r\n
          break;
        }

        if (buffer[crIndex + 1] === '\n') {
          // \r\n pair
          if (!discardingCurrentLine) {
            const rawLine = buffer.slice(0, crIndex);
            yield rawLine.length > maxLineBufferLength
              ? rawLine.slice(0, maxLineBufferLength)
              : rawLine;
          }
          buffer = buffer.slice(crIndex + 2);
          discardingCurrentLine = false;
          searchIndex = 0;
        } else {
          // Standalone \r
          if (!discardingCurrentLine) {
            const rawLine = buffer.slice(0, crIndex);
            yield rawLine.length > maxLineBufferLength
              ? rawLine.slice(0, maxLineBufferLength)
              : rawLine;
          }
          buffer = buffer.slice(crIndex + 1);
          discardingCurrentLine = false;
          searchIndex = 0;
        }
      } else if (lfIndex !== -1) {
        // Standalone \n
        if (!discardingCurrentLine) {
          const rawLine = buffer.slice(0, lfIndex);
          yield rawLine.length > maxLineBufferLength
            ? rawLine.slice(0, maxLineBufferLength)
            : rawLine;
        }
        buffer = buffer.slice(lfIndex + 1);
        discardingCurrentLine = false;
        searchIndex = 0;
      }
    }
  }

  // Flush remaining decoder bytes if any
  const finalChunk = decoder.end();
  if (finalChunk) {
    buffer += finalChunk;
  }

  // Flush remaining lines in buffer
  while (buffer.length > 0) {
    const crIndex = buffer.indexOf('\r');
    const lfIndex = buffer.indexOf('\n');

    if (crIndex === -1 && lfIndex === -1) {
      if (!discardingCurrentLine && buffer.length > 0) {
        yield buffer.length > maxLineBufferLength ? buffer.slice(0, maxLineBufferLength) : buffer;
      }
      buffer = '';
      break;
    }

    if (crIndex !== -1 && (lfIndex === -1 || crIndex < lfIndex)) {
      if (crIndex + 1 < buffer.length && buffer[crIndex + 1] === '\n') {
        if (!discardingCurrentLine) {
          const rawLine = buffer.slice(0, crIndex);
          yield rawLine.length > maxLineBufferLength
            ? rawLine.slice(0, maxLineBufferLength)
            : rawLine;
        }
        buffer = buffer.slice(crIndex + 2);
        discardingCurrentLine = false;
      } else {
        if (!discardingCurrentLine) {
          const rawLine = buffer.slice(0, crIndex);
          yield rawLine.length > maxLineBufferLength
            ? rawLine.slice(0, maxLineBufferLength)
            : rawLine;
        }
        buffer = buffer.slice(crIndex + 1);
        discardingCurrentLine = false;
      }
    } else if (lfIndex !== -1) {
      if (!discardingCurrentLine) {
        const rawLine = buffer.slice(0, lfIndex);
        yield rawLine.length > maxLineBufferLength
          ? rawLine.slice(0, maxLineBufferLength)
          : rawLine;
      }
      buffer = buffer.slice(lfIndex + 1);
      discardingCurrentLine = false;
    }
  }
}

export class GitHubLogStreamProvider implements LogStreamProvider {
  constructor(
    private readonly chunkStreamFactory: () => AsyncIterable<Uint8Array | Buffer | string>,
    private readonly estimatedSizeBytes?: number,
    private readonly options: ChunkedLogStreamOptions = {},
  ) {}

  getLineStream(): AsyncIterable<string> {
    return createChunkedLogStream(this.chunkStreamFactory(), this.options);
  }

  async getEstimatedSizeBytes(): Promise<number | undefined> {
    return this.estimatedSizeBytes;
  }
}
