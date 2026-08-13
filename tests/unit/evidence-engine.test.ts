import { describe, expect, it } from 'vitest';
import { EvidenceEngine } from '../../src/core/evidence-engine.js';
import { DetectorResult, EvidenceItem } from '../../src/core/types.js';

describe('EvidenceEngine', () => {
  it('deduplicates identical evidence and preserves highest relevance score', () => {
    const engine = new EvidenceEngine();

    const result1: DetectorResult = {
      category: 'DEPENDENCY',
      confidenceScore: 80,
      evidence: [
        {
          id: 'ev1',
          source: 'log_signature',
          description: 'Package resolution failed',
          snippet: 'ERESOLVE unable to resolve',
          relevanceScore: 70,
        },
      ],
    };

    const result2: DetectorResult = {
      category: 'DEPENDENCY',
      confidenceScore: 90,
      evidence: [
        {
          id: 'ev2',
          source: 'log_signature',
          description: 'Package resolution failed',
          snippet: 'ERESOLVE unable to resolve',
          relevanceScore: 95,
        },
      ],
    };

    const aggregated = engine.aggregate([result1, result2]);

    expect(aggregated).toHaveLength(1);
    expect(aggregated[0].relevanceScore).toBe(95);
    expect(aggregated[0].id).toBe('ev2');
  });

  it('preserves provenance for detector category and ID', () => {
    const engine = new EvidenceEngine();

    const result: DetectorResult = {
      category: 'NETWORK',
      confidenceScore: 95,
      evidence: [
        {
          id: 'net1',
          source: 'log_signature',
          description: 'Connection refused',
          relevanceScore: 95,
        },
      ],
    };

    const aggregated = engine.aggregate([result]);

    expect(aggregated[0].detectorCategory).toBe('NETWORK');
    expect(aggregated[0].detectorId).toBe('network_detector');
  });

  it('groups evidence by source and category', () => {
    const engine = new EvidenceEngine();

    const evidenceItems: EvidenceItem[] = [
      {
        id: '1',
        source: 'log_signature',
        description: 'Log error',
        relevanceScore: 80,
        detectorCategory: 'NETWORK',
      },
      {
        id: '2',
        source: 'exit_code',
        description: 'Exit code 1',
        relevanceScore: 90,
        detectorCategory: 'NETWORK',
      },
      {
        id: '3',
        source: 'log_signature',
        description: 'Compiler error',
        relevanceScore: 85,
        detectorCategory: 'BUILD',
      },
    ];

    const bySource = engine.groupBySource(evidenceItems);
    expect(bySource['log_signature']).toHaveLength(2);
    expect(bySource['exit_code']).toHaveLength(1);

    const byCategory = engine.groupByCategory(evidenceItems);
    expect(byCategory.get('NETWORK')).toHaveLength(2);
    expect(byCategory.get('BUILD')).toHaveLength(1);
  });

  it('does not mutate original detector results or evidence items', () => {
    const engine = new EvidenceEngine();

    const originalItem: EvidenceItem = {
      id: 'orig1',
      source: 'log_signature',
      description: 'Original error',
      relevanceScore: 80,
    };

    const result: DetectorResult = {
      category: 'BUILD',
      confidenceScore: 80,
      evidence: [originalItem],
    };

    const aggregated = engine.aggregate([result]);
    aggregated[0].relevanceScore = 99;

    expect(originalItem.relevanceScore).toBe(80);
    expect(result.evidence[0].relevanceScore).toBe(80);
  });
});
