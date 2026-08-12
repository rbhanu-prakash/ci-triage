/**
 * Parser Layer: Context Windows
 *
 * Bounded context-window mechanism for log stream parsing.
 * Captures configurable lines before and after detected error signatures,
 * merges overlapping windows, and caps total retained frames to prevent memory explosion.
 */

import { FailureFingerprint } from '../core/types.js';
import { generateFingerprint } from './fingerprint.js';

export interface ContextWindowConfig {
  /** Number of context lines to retain before the error (default: 20) */
  linesBefore: number;
  /** Number of context lines to retain after the error (default: 40) */
  linesAfter: number;
  /** Maximum number of distinct frames to store in memory (default: 50) */
  maxFrames: number;
  /** Maximum line length in characters retained in context frames (default: 8192) */
  maxLineLength: number;
}

export const DEFAULT_CONTEXT_CONFIG: ContextWindowConfig = {
  linesBefore: 20,
  linesAfter: 40,
  maxFrames: 50,
  maxLineLength: 8192,
};

export interface ContextFrame {
  id: string;
  errorLineIndex: number;
  rawErrorLine: string;
  normalizedErrorLine: string;
  fingerprint: FailureFingerprint;
  startLineIndex: number;
  endLineIndex: number;
  linesBefore: string[];
  linesAfter: string[];
  mergedErrorIndices: number[];
}

export class ContextWindowManager {
  private config: ContextWindowConfig;
  private customSecretPatterns: string[];
  private ringBuffer: string[] = [];
  private completedFrames: ContextFrame[] = [];
  private pendingFrames: ContextFrame[] = [];
  private totalErrorsDetected = 0;

  constructor(config: Partial<ContextWindowConfig> = {}, customSecretPatterns: string[] = []) {
    this.config = { ...DEFAULT_CONTEXT_CONFIG, ...config };
    this.customSecretPatterns = customSecretPatterns;
  }

  /**
   * Process a single sanitized log line in sequence.
   */
  public processLine(line: string, lineIndex: number, isError: boolean): void {
    if (line.length > this.config.maxLineLength) {
      line = line.slice(0, this.config.maxLineLength) + '... [truncated]';
    }

    // 1. If currently collecting linesAfter for active pending frames, append this line
    for (const frame of this.pendingFrames) {
      if (lineIndex > frame.errorLineIndex && lineIndex <= frame.endLineIndex) {
        frame.linesAfter.push(line);
      }
    }

    // Move pending frames that have completed line collection to completedFrames
    this.pendingFrames = this.pendingFrames.filter((frame) => {
      if (lineIndex >= frame.endLineIndex) {
        this.addCompletedFrame(frame);
        return false;
      }
      return true;
    });

    // 2. If this line is a detected error signature
    if (isError) {
      this.totalErrorsDetected++;

      // Check if an existing pending frame overlaps this line
      const overlappingPending = this.pendingFrames.find(
        (f) => lineIndex <= f.endLineIndex + this.config.linesBefore,
      );

      if (overlappingPending) {
        // Merge into existing pending frame
        overlappingPending.endLineIndex = lineIndex + this.config.linesAfter;
        overlappingPending.mergedErrorIndices.push(lineIndex);
      } else {
        // Create a new frame
        const fingerprint = generateFingerprint(line, this.customSecretPatterns);
        const startLineIndex = Math.max(0, lineIndex - this.ringBuffer.length);

        const newFrame: ContextFrame = {
          id: `frame_${lineIndex}_${this.totalErrorsDetected}`,
          errorLineIndex: lineIndex,
          rawErrorLine: fingerprint.rawErrorLine,
          normalizedErrorLine: fingerprint.normalizedErrorLine,
          fingerprint,
          startLineIndex,
          endLineIndex: lineIndex + this.config.linesAfter,
          linesBefore: [...this.ringBuffer],
          linesAfter: [],
          mergedErrorIndices: [lineIndex],
        };

        if (this.config.linesAfter === 0) {
          this.addCompletedFrame(newFrame);
        } else {
          this.pendingFrames.push(newFrame);
        }
      }
    }

    // 3. Maintain ring buffer for linesBefore
    this.ringBuffer.push(line);
    if (this.ringBuffer.length > this.config.linesBefore) {
      this.ringBuffer.shift();
    }
  }

  private addCompletedFrame(frame: ContextFrame): void {
    if (this.completedFrames.length >= this.config.maxFrames) {
      // Memory bound reached: ignore or drop excess frames
      return;
    }
    this.completedFrames.push(frame);
  }

  /**
   * Flushes all pending frames at the end of log stream processing.
   */
  public finalize(): ContextFrame[] {
    for (const frame of this.pendingFrames) {
      this.addCompletedFrame(frame);
    }
    this.pendingFrames = [];
    return this.completedFrames;
  }

  public getTotalErrorsDetected(): number {
    return this.totalErrorsDetected;
  }
}
