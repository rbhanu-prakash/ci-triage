import { describe, expect, it } from 'vitest';
import { Classifier } from '../../src/core/classifier.js';
import { DetectorResult } from '../../src/core/types.js';

describe('Classifier (Phase 4)', () => {
  const classifier = new Classifier();

  it('1. single strong detector yields primary classification', () => {
    const results: DetectorResult[] = [
      {
        category: 'DEPENDENCY',
        confidenceScore: 90,
        evidence: [
          {
            id: 'dep1',
            source: 'log_signature',
            description: 'npm reported ERESOLVE',
            snippet: 'ERESOLVE unable to resolve',
            relevanceScore: 90,
          },
        ],
      },
    ];

    const report = classifier.classify(results);

    expect(report.classification).toBe('DEPENDENCY');
    expect(report.confidence).toBe(90);
    expect(report.recommendedAction).toContain('package/version constraints');
  });

  it('2. multiple corroborating evidence items boost confidence', () => {
    const results: DetectorResult[] = [
      {
        category: 'NETWORK',
        confidenceScore: 85,
        evidence: [
          {
            id: 'net1',
            source: 'log_signature',
            description: 'Connection refused to remote host',
            relevanceScore: 85,
            detectorCategory: 'NETWORK',
          },
          {
            id: 'net2',
            source: 'exit_code',
            description: 'Network socket failure with exit code 1',
            relevanceScore: 80,
            detectorCategory: 'NETWORK',
          },
        ],
      },
    ];

    const report = classifier.classify(results);

    expect(report.classification).toBe('NETWORK');
    // Base 85 + 5 (corroboration item) + 5 (diversity of source log_signature + exit_code) = 95
    expect(report.confidence).toBe(95);
  });

  it('3. conflicting detectors trigger conflict resolution and penalty', () => {
    const results: DetectorResult[] = [
      {
        category: 'DEPENDENCY',
        confidenceScore: 85,
        evidence: [
          {
            id: 'dep1',
            source: 'log_signature',
            description: 'Package resolution error',
            relevanceScore: 85,
            detectorCategory: 'DEPENDENCY',
          },
        ],
      },
      {
        category: 'NETWORK',
        confidenceScore: 80,
        evidence: [
          {
            id: 'net1',
            source: 'log_signature',
            description: 'Registry connection timeout',
            relevanceScore: 80,
            detectorCategory: 'NETWORK',
          },
        ],
      },
    ];

    const report = classifier.classify(results);

    // Conflict penalty -15 applied
    expect(report.confidence).toBeLessThan(85);
    expect(report.secondarySignals).toBeDefined();
    expect(report.secondarySignals?.some((s) => s.category === 'NETWORK')).toBe(true);
  });

  it('4. duplicate evidence across detectors does not artificially inflate confidence', () => {
    const results: DetectorResult[] = [
      {
        category: 'BUILD',
        confidenceScore: 80,
        evidence: [
          {
            id: 'b1',
            source: 'log_signature',
            description: 'Syntax error in index.ts',
            snippet: 'SyntaxError: unexpected token',
            relevanceScore: 80,
          },
        ],
      },
      {
        category: 'BUILD',
        confidenceScore: 80,
        evidence: [
          {
            id: 'b2',
            source: 'log_signature',
            description: 'Syntax error in index.ts',
            snippet: 'SyntaxError: unexpected token',
            relevanceScore: 80,
          },
        ],
      },
    ];

    const report = classifier.classify(results);

    expect(report.observedEvidence).toHaveLength(1);
    expect(report.confidence).toBe(80);
  });

  it('5. populates secondary signals for non-primary candidate detectors', () => {
    const results: DetectorResult[] = [
      {
        category: 'DEPENDENCY',
        confidenceScore: 90,
        evidence: [
          {
            id: 'dep1',
            source: 'log_signature',
            description: 'Dependency error',
            relevanceScore: 90,
          },
        ],
      },
      {
        category: 'NETWORK',
        confidenceScore: 60,
        evidence: [
          {
            id: 'net1',
            source: 'log_signature',
            description: 'HTTP status 503 from mirror',
            relevanceScore: 60,
          },
        ],
      },
    ];

    const report = classifier.classify(results);

    expect(report.classification).toBe('DEPENDENCY');
    expect(report.secondarySignals).toBeDefined();
    expect(report.secondarySignals?.[0].category).toBe('NETWORK');
    expect(report.secondarySignals?.[0].confidence).toBe(60);
  });

  it('6. caps final confidence score strictly at 100', () => {
    const results: DetectorResult[] = [
      {
        category: 'BUILD',
        confidenceScore: 95,
        evidence: [
          {
            id: 'e1',
            source: 'log_signature',
            description: 'Compiler error 1',
            relevanceScore: 95,
            detectorCategory: 'BUILD',
          },
          {
            id: 'e2',
            source: 'exit_code',
            description: 'Compiler error 2',
            relevanceScore: 95,
            detectorCategory: 'BUILD',
          },
          {
            id: 'e3',
            source: 'diff_correlation',
            description: 'Compiler error 3',
            relevanceScore: 95,
            detectorCategory: 'BUILD',
          },
        ],
      },
    ];

    const report = classifier.classify(results);

    expect(report.confidence).toBe(100);
  });

  it('7. applies unknownThreshold behavior when confidence is below threshold', () => {
    const results: DetectorResult[] = [
      {
        category: 'CODE_REGRESSION',
        confidenceScore: 40,
        evidence: [
          {
            id: 'cr1',
            source: 'log_signature',
            description: 'Weak changed file reference',
            relevanceScore: 40,
          },
        ],
      },
    ];

    const report = classifier.classify(results, {
      config: {
        historyDepth: 10,
        unknownThreshold: 50,
        minFlakyConfidence: 75,
        minRegressionConfidence: 80,
        maxLogSizeBytes: 10 * 1024 * 1024,
        commentOnPR: false,
        customSecretPatterns: [],
      },
    });

    expect(report.classification).toBe('UNKNOWN');
    expect(report.confidence).toBe(40);
    expect(report.recommendedAction).toContain('Manually inspect');
  });

  it('8. yields UNKNOWN on empty results or insufficient evidence', () => {
    const report = classifier.classify([]);

    expect(report.classification).toBe('UNKNOWN');
    expect(report.confidence).toBe(0);
    expect(report.observedEvidence).toHaveLength(0);
  });

  it('9. correctly maps recommended actions for each category', () => {
    const categories = [
      'NETWORK',
      'DEPENDENCY',
      'TIMEOUT',
      'PERMISSION',
      'BUILD',
      'TEST_FAILURE',
      'FLAKY_TEST',
      'CODE_REGRESSION',
      'CONFIGURATION',
      'RESOURCE',
      'UNKNOWN',
    ] as const;

    for (const cat of categories) {
      const results: DetectorResult[] = [
        {
          category: cat,
          confidenceScore: 90,
          evidence: [
            {
              id: 'ev1',
              source: 'log_signature',
              description: `Sample error for ${cat}`,
              relevanceScore: 90,
            },
          ],
        },
      ];

      const report = classifier.classify(results, {
        config: {
          historyDepth: 10,
          unknownThreshold: 10, // low threshold to pass UNKNOWN
          minFlakyConfidence: 75,
          minRegressionConfidence: 80,
          maxLogSizeBytes: 10 * 1024 * 1024,
          commentOnPR: false,
          customSecretPatterns: [],
        },
      });

      expect(report.recommendedAction).toBeDefined();
      expect(report.recommendedAction.length).toBeGreaterThan(10);
    }
  });

  it('10. cleanly separates OBSERVED FACTS from CLASSIFIER INFERENCE in inferenceDetails', () => {
    const results: DetectorResult[] = [
      {
        category: 'DEPENDENCY',
        confidenceScore: 88,
        evidence: [
          {
            id: 'ev1',
            source: 'log_signature',
            description: 'npm reported ERESOLVE unable to resolve dependency tree',
            relevanceScore: 88,
          },
        ],
      },
    ];

    const report = classifier.classify(results);

    expect(report.inferenceDetails).toContain('OBSERVED FACTS:');
    expect(report.inferenceDetails).toContain(
      '- npm reported ERESOLVE unable to resolve dependency tree',
    );
    expect(report.inferenceDetails).toContain('CLASSIFIER INFERENCE:');
    expect(report.inferenceDetails).toContain(
      'The failure is most consistent with a dependency issue.',
    );
  });

  it('11. yields deterministic repeated execution given identical input', () => {
    const results: DetectorResult[] = [
      {
        category: 'NETWORK',
        confidenceScore: 85,
        evidence: [
          {
            id: 'net1',
            source: 'log_signature',
            description: 'ECONNREFUSED 127.0.0.1:5432',
            relevanceScore: 85,
          },
        ],
      },
    ];

    const report1 = classifier.classify(results);
    const report2 = classifier.classify(results);

    expect(report1).toEqual(report2);
  });

  it('12. secrets remain redacted in evidence and report output', () => {
    const results: DetectorResult[] = [
      {
        category: 'CONFIGURATION',
        confidenceScore: 90,
        evidence: [
          {
            id: 'cfg1',
            source: 'log_signature',
            description: 'Invalid secret format for GH_TOKEN [REDACTED]',
            snippet: 'TOKEN=***',
            relevanceScore: 90,
          },
        ],
      },
    ];

    const report = classifier.classify(results);

    expect(report.observedEvidence[0].description).not.toContain('ghp_secret123');
    expect(report.inferenceDetails).not.toContain('ghp_secret123');
  });

  it('13. flaky test as primary classification when supported by threshold', () => {
    const results: DetectorResult[] = [
      {
        category: 'FLAKY_TEST',
        confidenceScore: 85,
        evidence: [
          {
            id: 'fl1',
            source: 'history_match',
            description: 'Test passed in 3 historical runs and failed in 2',
            relevanceScore: 85,
          },
        ],
      },
      {
        category: 'TEST_FAILURE',
        confidenceScore: 80,
        evidence: [
          {
            id: 'tf1',
            source: 'log_signature',
            description: 'AssertionError in async test',
            relevanceScore: 80,
          },
        ],
      },
    ];

    const report = classifier.classify(results);

    expect(report.classification).toBe('FLAKY_TEST');
  });

  it('14. network overriding weak code-regression signal', () => {
    const results: DetectorResult[] = [
      {
        category: 'CODE_REGRESSION',
        confidenceScore: 60,
        evidence: [
          {
            id: 'cr1',
            source: 'log_signature',
            description: 'Mentioned config.json in passing',
            relevanceScore: 60,
          },
        ],
      },
      {
        category: 'NETWORK',
        confidenceScore: 90,
        evidence: [
          {
            id: 'net1',
            source: 'log_signature',
            description: 'connect ECONNREFUSED 10.0.0.1:443',
            relevanceScore: 90,
          },
        ],
      },
    ];

    const report = classifier.classify(results);

    expect(report.classification).toBe('NETWORK');
  });

  it('15. dependency vs network conflict resolution', () => {
    const results: DetectorResult[] = [
      {
        category: 'DEPENDENCY',
        confidenceScore: 85,
        evidence: [
          {
            id: 'dep1',
            source: 'log_signature',
            description: 'npm package ERESOLVE conflict',
            relevanceScore: 85,
          },
        ],
      },
      {
        category: 'NETWORK',
        confidenceScore: 80,
        evidence: [
          {
            id: 'net1',
            source: 'log_signature',
            description: 'Registry mirror fetch timeout',
            relevanceScore: 80,
          },
        ],
      },
    ];

    const report = classifier.classify(results);

    expect(report.classification).toBe('DEPENDENCY');
    expect(report.secondarySignals).toBeDefined();
    expect(report.secondarySignals?.some((s) => s.category === 'NETWORK')).toBe(true);
  });

  it('16. build vs test conflict selects build as upstream primary cause', () => {
    const results: DetectorResult[] = [
      {
        category: 'BUILD',
        confidenceScore: 90,
        evidence: [
          {
            id: 'b1',
            source: 'log_signature',
            description: 'TypeScript error TS2307: Cannot find module ./auth',
            relevanceScore: 90,
          },
        ],
      },
      {
        category: 'TEST_FAILURE',
        confidenceScore: 80,
        evidence: [
          {
            id: 'tf1',
            source: 'log_signature',
            description: 'Test suite failed to run due to missing module import',
            relevanceScore: 80,
          },
        ],
      },
    ];

    const report = classifier.classify(results);

    expect(report.classification).toBe('BUILD');
    expect(report.secondarySignals?.some((s) => s.category === 'TEST_FAILURE')).toBe(true);
  });
});
