import { describe, it, expect } from 'vitest';
import { ContextWindowManager } from '../../src/parser/context-window.js';

describe('Context Window Manager', () => {
  it('should capture specified before and after context lines around an error', () => {
    const manager = new ContextWindowManager({ linesBefore: 2, linesAfter: 3 });

    // Lines 0..1 (before), Line 2 (Error), Lines 3..5 (after)
    manager.processLine('line 0: setup', 0, false);
    manager.processLine('line 1: step start', 1, false);
    manager.processLine('Error: test failed', 2, true);
    manager.processLine('line 3: teardown start', 3, false);
    manager.processLine('line 4: cleanup', 4, false);
    manager.processLine('line 5: finish', 5, false);

    const frames = manager.finalize();

    expect(frames.length).toBe(1);
    const frame = frames[0];
    expect(frame.errorLineIndex).toBe(2);
    expect(frame.linesBefore).toEqual(['line 0: setup', 'line 1: step start']);
    expect(frame.linesAfter).toEqual([
      'line 3: teardown start',
      'line 4: cleanup',
      'line 5: finish',
    ]);
  });

  it('should handle beginning-of-log boundary cleanly', () => {
    const manager = new ContextWindowManager({ linesBefore: 5, linesAfter: 2 });

    // Error occurs at line index 0 (no preceding lines)
    manager.processLine('Error: immediate failure', 0, true);
    manager.processLine('line 1: post error', 1, false);
    manager.processLine('line 2: post error 2', 2, false);

    const frames = manager.finalize();

    expect(frames.length).toBe(1);
    expect(frames[0].linesBefore).toEqual([]);
    expect(frames[0].linesAfter).toEqual(['line 1: post error', 'line 2: post error 2']);
  });

  it('should handle end-of-log boundary cleanly', () => {
    const manager = new ContextWindowManager({ linesBefore: 2, linesAfter: 10 });

    manager.processLine('line 0', 0, false);
    manager.processLine('line 1', 1, false);
    manager.processLine('Error: end failure', 2, true);
    manager.processLine('line 3: final line', 3, false);

    // Stream ends abruptly after line 3
    const frames = manager.finalize();

    expect(frames.length).toBe(1);
    expect(frames[0].linesAfter).toEqual(['line 3: final line']);
  });

  it('should merge overlapping context windows when errors occur close together', () => {
    const manager = new ContextWindowManager({ linesBefore: 2, linesAfter: 5 });

    manager.processLine('line 0', 0, false);
    manager.processLine('Error 1', 1, true);
    manager.processLine('line 2', 2, false);
    manager.processLine('Error 2', 3, true); // occurs within linesAfter of Error 1
    manager.processLine('line 4', 4, false);
    manager.processLine('line 5', 5, false);

    const frames = manager.finalize();

    expect(frames.length).toBe(1);
    expect(frames[0].mergedErrorIndices).toEqual([1, 3]);
  });

  it('should enforce maxFrames to prevent unbounded memory growth', () => {
    const manager = new ContextWindowManager({ linesBefore: 1, linesAfter: 1, maxFrames: 3 });

    // Send 10 distinct error signatures
    for (let i = 0; i < 20; i++) {
      manager.processLine(`Error ${i}`, i, true);
    }

    const frames = manager.finalize();

    expect(frames.length).toBeLessThanOrEqual(3);
  });
});
