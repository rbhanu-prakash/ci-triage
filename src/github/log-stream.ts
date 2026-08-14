import { StringDecoder } from 'node:string_decoder';
import { LogStreamProvider } from '../core/types.js';

/**
 * Creates an AsyncIterable<string> that incrementally processes chunks of data (Uint8Array, Buffer, or string),
 * properly handles UTF-8 multi-byte characters split across chunk boundaries, splits lines on \n, \r\n, or standalone \r,
 * and yields lines without buffering the entire stream into memory.
 */
export async function* createChunkedLogStream(
  chunks: AsyncIterable<Uint8Array | Buffer | string>,
): AsyncIterable<string> {
  const decoder = new StringDecoder('utf8');
  let buffer = '';

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
          const line = buffer.slice(0, crIndex);
          yield line;
          buffer = buffer.slice(crIndex + 2);
          searchIndex = 0;
        } else {
          // Standalone \r
          const line = buffer.slice(0, crIndex);
          yield line;
          buffer = buffer.slice(crIndex + 1);
          searchIndex = 0;
        }
      } else if (lfIndex !== -1) {
        // Standalone \n
        const line = buffer.slice(0, lfIndex);
        yield line;
        buffer = buffer.slice(lfIndex + 1);
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
      yield buffer;
      buffer = '';
      break;
    }

    if (crIndex !== -1 && (lfIndex === -1 || crIndex < lfIndex)) {
      if (crIndex + 1 < buffer.length && buffer[crIndex + 1] === '\n') {
        const line = buffer.slice(0, crIndex);
        yield line;
        buffer = buffer.slice(crIndex + 2);
      } else {
        const line = buffer.slice(0, crIndex);
        yield line;
        buffer = buffer.slice(crIndex + 1);
      }
    } else if (lfIndex !== -1) {
      const line = buffer.slice(0, lfIndex);
      yield line;
      buffer = buffer.slice(lfIndex + 1);
    }
  }
}

export class GitHubLogStreamProvider implements LogStreamProvider {
  constructor(
    private readonly chunkStreamFactory: () => AsyncIterable<Uint8Array | Buffer | string>,
    private readonly estimatedSizeBytes?: number,
  ) {}

  getLineStream(): AsyncIterable<string> {
    return createChunkedLogStream(this.chunkStreamFactory());
  }

  async getEstimatedSizeBytes(): Promise<number | undefined> {
    return this.estimatedSizeBytes;
  }
}
