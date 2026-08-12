import { LogStreamProvider } from './types.js';

/**
 * StringLogStreamProvider is an in-memory test/local convenience implementation.
 *
 * ARCHITECTURAL NOTICE:
 * This provider buffers the entire log content in memory as a string and splits it
 * into an array of lines. Therefore, it is NOT bounded-memory for arbitrary large logs.
 * It is designed strictly for unit tests, small local strings, and deterministic fixtures.
 *
 * Production integrations (such as the GitHub Actions log streaming adapter) MUST
 * supply a true streaming LogStreamProvider (e.g. wrapping a Node.js ReadableStream or
 * chunked HTTP reader) that yields log lines incrementally without loading the entire log
 * into memory at once.
 */
export class StringLogStreamProvider implements LogStreamProvider {
  private content: string;

  constructor(content: string) {
    this.content = content;
  }

  async *getLineStream(): AsyncIterable<string> {
    const lines = this.content.split(/\r?\n/);
    for (const line of lines) {
      yield line;
    }
  }

  async getEstimatedSizeBytes(): Promise<number | undefined> {
    return Buffer.byteLength(this.content, 'utf-8');
  }
}

export function createStringLogProvider(content: string): LogStreamProvider {
  return new StringLogStreamProvider(content);
}

/**
 * IncrementalArrayLogStreamProvider is a lightweight test and fixture provider
 * that yields lines incrementally from an iterable or generator without joining or
 * splitting a monolithic string in memory.
 */
export class IncrementalArrayLogStreamProvider implements LogStreamProvider {
  private linesSource: Iterable<string> | AsyncIterable<string> | (() => AsyncGenerator<string>);
  private estimatedSizeBytes?: number;

  constructor(
    linesSource: Iterable<string> | AsyncIterable<string> | (() => AsyncGenerator<string>),
    estimatedSizeBytes?: number,
  ) {
    this.linesSource = linesSource;
    this.estimatedSizeBytes = estimatedSizeBytes;
  }

  async *getLineStream(): AsyncIterable<string> {
    const source = typeof this.linesSource === 'function' ? this.linesSource() : this.linesSource;
    for await (const line of source) {
      yield line;
    }
  }

  async getEstimatedSizeBytes(): Promise<number | undefined> {
    return this.estimatedSizeBytes;
  }
}

export function createIncrementalLogProvider(
  lines: Iterable<string> | AsyncIterable<string> | (() => AsyncGenerator<string>),
  estimatedSizeBytes?: number,
): LogStreamProvider {
  return new IncrementalArrayLogStreamProvider(lines, estimatedSizeBytes);
}
