import { DetectorResult, EvidenceItem, FailureCategory } from './types.js';

export class EvidenceEngine {
  /**
   * Aggregates and deduplicates evidence items across all provided detector results without mutating inputs.
   */
  public aggregate(results: DetectorResult[]): EvidenceItem[] {
    const aggregatedMap = new Map<string, EvidenceItem>();

    for (const result of results) {
      for (const item of result.evidence) {
        // Create deduplication key based on normalized description and snippet
        const normDesc = item.description.trim().toLowerCase();
        const normSnippet = (item.snippet || '').trim().toLowerCase();
        const dedupKey = `${item.source}::${normDesc}::${normSnippet}`;

        const provenanceCategory = item.detectorCategory || result.category;
        const provenanceId = item.detectorId || `${result.category.toLowerCase()}_detector`;

        const existing = aggregatedMap.get(dedupKey);

        if (!existing) {
          aggregatedMap.set(dedupKey, {
            id: item.id,
            source: item.source,
            description: item.description,
            snippet: item.snippet,
            relevanceScore: item.relevanceScore,
            detectorCategory: provenanceCategory,
            detectorId: provenanceId,
          });
        } else {
          // Preserve the highest-relevance copy when duplicates occur
          if (item.relevanceScore > existing.relevanceScore) {
            aggregatedMap.set(dedupKey, {
              id: item.id,
              source: item.source,
              description: item.description,
              snippet: item.snippet,
              relevanceScore: item.relevanceScore,
              detectorCategory: provenanceCategory,
              detectorId: provenanceId,
            });
          }
        }
      }
    }

    // Return deduplicated evidence items sorted by relevance score descending
    return Array.from(aggregatedMap.values()).sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  /**
   * Groups evidence items by source type.
   */
  public groupBySource(evidence: EvidenceItem[]): Record<string, EvidenceItem[]> {
    const grouped: Record<string, EvidenceItem[]> = {};
    for (const item of evidence) {
      if (!grouped[item.source]) {
        grouped[item.source] = [];
      }
      grouped[item.source].push(item);
    }
    return grouped;
  }

  /**
   * Groups evidence items by failure category provenance.
   */
  public groupByCategory(evidence: EvidenceItem[]): Map<FailureCategory, EvidenceItem[]> {
    const grouped = new Map<FailureCategory, EvidenceItem[]>();
    for (const item of evidence) {
      const cat = item.detectorCategory || 'UNKNOWN';
      if (!grouped.has(cat)) {
        grouped.set(cat, []);
      }
      grouped.get(cat)!.push(item);
    }
    return grouped;
  }
}
