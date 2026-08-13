import { describe, expect, it } from 'vitest';
import { generateMarkdownReport } from '../../src/reporter/markdown.js';
import { TriageReport } from '../../src/core/types.js';

describe('Reporter (Markdown)', () => {
  it('renders a complete Markdown report with all sections', () => {
    const report: TriageReport = {
      classification: 'DEPENDENCY',
      confidence: 88,
      observedEvidence: [
        {
          id: 'ev1',
          source: 'log_signature',
          description: 'npm reported ERESOLVE',
          snippet: 'ERESOLVE unable to resolve dependency tree',
          relevanceScore: 90,
        },
      ],
      inferenceDetails:
        'OBSERVED FACTS:\n- npm reported ERESOLVE\n\nCLASSIFIER INFERENCE:\nThe failure is most consistent with a dependency issue.',
      recommendedAction: 'Review package/version constraints and lockfile consistency.',
      jobName: 'build_job',
      stepName: 'Install dependencies',
      secondarySignals: [
        {
          category: 'NETWORK',
          confidence: 62,
          description: 'Supporting registry timeout signal',
        },
      ],
      metadata: {
        historyAnalyzed: 5,
        logBytesProcessed: 1024,
        durationMs: 42,
      },
    };

    const markdown = generateMarkdownReport(report);

    expect(markdown).toContain('# CI Triage');
    expect(markdown).toContain('## Classification');
    expect(markdown).toContain('`DEPENDENCY`');
    expect(markdown).toContain('## Confidence');
    expect(markdown).toContain('88 / 100');
    expect(markdown).toContain('## Evidence');
    expect(markdown).toContain('**log_signature**: npm reported ERESOLVE');
    expect(markdown).toContain('## Inference');
    expect(markdown).toContain('## Secondary Signals');
    expect(markdown).toContain('**NETWORK** (Confidence: 62)');
    expect(markdown).toContain('## Recommended Action');
    expect(markdown).toContain('Review package/version constraints');
  });

  it('safely renders evidence snippets containing backticks, newlines, and long strings', () => {
    const report: TriageReport = {
      classification: 'BUILD',
      confidence: 90,
      observedEvidence: [
        {
          id: 'ev1',
          source: 'log_signature',
          description: 'Compiler output',
          snippet: 'Error: invalid import `src/index.ts`\n  at line 42',
          relevanceScore: 90,
        },
        {
          id: 'ev2',
          source: 'log_signature',
          description: 'Very long log line',
          snippet: 'A'.repeat(500),
          relevanceScore: 85,
        },
      ],
      inferenceDetails: 'The failure is most consistent with a build issue.',
      recommendedAction: 'Inspect compiler errors.',
      jobName: 'build_job',
      stepName: 'Compile',
      metadata: {
        historyAnalyzed: 0,
        logBytesProcessed: 0,
        durationMs: 0,
      },
    };

    const markdown = generateMarkdownReport(report);

    // Fenced code block used for multiline/backticks snippet
    expect(markdown).toContain('```');
    expect(markdown).toContain('Error: invalid import `src/index.ts`');
    // Bounded snippet length (truncated to max 300)
    expect(markdown).toContain('A'.repeat(300) + '...');
  });

  it('omits Secondary Signals section when secondarySignals is empty or undefined', () => {
    const report: TriageReport = {
      classification: 'BUILD',
      confidence: 95,
      observedEvidence: [
        {
          id: 'ev1',
          source: 'log_signature',
          description: 'TS2307 error',
          relevanceScore: 95,
        },
      ],
      inferenceDetails: 'OBSERVED FACTS:\n- TS2307\n\nCLASSIFIER INFERENCE:\nBuild error.',
      recommendedAction: 'Inspect compiler errors.',
      jobName: 'build_job',
      stepName: 'Build TypeScript',
      metadata: {
        historyAnalyzed: 0,
        logBytesProcessed: 500,
        durationMs: 10,
      },
    };

    const markdown = generateMarkdownReport(report);

    expect(markdown).not.toContain('## Secondary Signals');
  });
});
