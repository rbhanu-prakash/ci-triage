import { LogStreamProvider } from './types.js';

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

  async getEstimatedSizeBytes(): Promise<number> {
    return Buffer.byteLength(this.content, 'utf-8');
  }
}

export function createStringLogProvider(content: string): LogStreamProvider {
  return new StringLogStreamProvider(content);
}
