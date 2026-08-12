/**
 * Parser Layer: Bounded-Memory Log Stream Parser
 *
 * Processes log streams sequentially/chunked without buffering the entire log in memory.
 * Enforces maxLogSizeBytes, strips ANSI codes, redacts secrets, detects error signatures,
 * and extracts bounded context windows.
 */

import { LogStreamProvider, AnalysisConfig } from '../core/types.js';
import { redactSecrets } from '../security/redactor.js';
import { stripAnsi } from './fingerprint.js';
import { isErrorSignature } from './error-patterns.js';
import { ContextWindowManager, ContextFrame, ContextWindowConfig } from './context-window.js';

export interface StreamParserOptions {
  /** Maximum log size in bytes to process before truncating (default: 10MB) */
  maxLogSizeBytes?: number;
  /** Custom user secret patterns to sanitize */
  customSecretPatterns?: string[];
  /** Custom error signature patterns */
  customErrorSignatures?: string[];
  /** Context window configuration */
  contextConfig?: Partial<ContextWindowConfig>;
}

export interface LogParseResult {
  frames: ContextFrame[];
  bytesProcessed: number;
  totalLinesProcessed: number;
  totalErrorsDetected: number;
  truncated: boolean;
}

export class StreamLogParser {
  private options: StreamParserOptions;

  constructor(options: StreamParserOptions = {}) {
    this.options = options;
  }

  /**
   * Iteratively parses a LogStreamProvider without buffering the whole log.
   */
  public async parse(logProvider: LogStreamProvider): Promise<LogParseResult> {
    const maxBytes = this.options.maxLogSizeBytes ?? 10 * 1024 * 1024; // 10MB default
    const customPatterns = this.options.customSecretPatterns ?? [];
    const customSignatures = this.options.customErrorSignatures;

    const contextManager = new ContextWindowManager(this.options.contextConfig, customPatterns);

    let bytesProcessed = 0;
    let lineIndex = 0;
    let truncated = false;

    for await (const rawLine of logProvider.getLineStream()) {
      // Calculate byte length of line (+1 for newline character)
      const lineBytes = Buffer.byteLength(rawLine, 'utf-8') + 1;

      if (bytesProcessed + lineBytes > maxBytes) {
        truncated = true;
        break;
      }

      bytesProcessed += lineBytes;

      // 1. Strip ANSI escape codes
      const cleanLine = stripAnsi(rawLine);

      // 2. Redact secrets
      const redactedLine = redactSecrets(cleanLine, customPatterns);

      // 3. Detect candidate error signatures
      const hasError = isErrorSignature(redactedLine, customSignatures);

      // 4. Process line in ContextWindowManager
      contextManager.processLine(redactedLine, lineIndex, hasError);

      lineIndex++;
    }

    const frames = contextManager.finalize();

    return {
      frames,
      bytesProcessed,
      totalLinesProcessed: lineIndex,
      totalErrorsDetected: contextManager.getTotalErrorsDetected(),
      truncated,
    };
  }
}

/**
 * Helper function to parse a LogStreamProvider using analysis configuration.
 */
export async function parseLogStream(
  logProvider: LogStreamProvider,
  config?: Partial<AnalysisConfig>,
  contextConfig?: Partial<ContextWindowConfig>,
): Promise<LogParseResult> {
  const parser = new StreamLogParser({
    maxLogSizeBytes: config?.maxLogSizeBytes,
    customSecretPatterns: config?.customSecretPatterns,
    contextConfig,
  });

  return parser.parse(logProvider);
}
