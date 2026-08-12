import { describe, it, expect } from 'vitest';
import { createStringLogProvider } from '../src/core/log-provider.js';
import type { AnalysisConfig } from '../src/core/types.js';

describe('Phase 1 Baseline Infrastructure', () => {
  it('should initialize StringLogStreamProvider and yield line stream correctly', async () => {
    const rawLog = 'Line 1: Workflow Started\nLine 2: Step Failed\nLine 3: Process Exit 1';
    const provider = createStringLogProvider(rawLog);

    const size = await provider.getEstimatedSizeBytes();
    expect(size).toBeGreaterThan(0);

    const lines: string[] = [];
    for await (const line of provider.getLineStream()) {
      lines.push(line);
    }

    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('Line 1: Workflow Started');
    expect(lines[1]).toBe('Line 2: Step Failed');
    expect(lines[2]).toBe('Line 3: Process Exit 1');
  });

  it('should enforce AnalysisConfig structure', () => {
    const config: AnalysisConfig = {
      historyDepth: 10,
      unknownThreshold: 50,
      minFlakyConfidence: 75,
      minRegressionConfidence: 80,
      maxLogSizeBytes: 10 * 1024 * 1024,
      commentOnPR: false,
      customSecretPatterns: [],
    };

    expect(config.historyDepth).toBe(10);
    expect(config.commentOnPR).toBe(false);
  });
});
