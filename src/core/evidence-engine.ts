import { DetectorResult, EvidenceContributor, EvidenceItem, FailureCategory } from './types.js';

export class EvidenceEngine {
  /**
   * Aggregates and deduplicates evidence items across all provided detector results without mutating inputs.
   * Preserves all contributing detector identities for corroboration provenance.
   */
  public aggregate(results: DetectorResult[]): EvidenceItem[] {
    const aggregatedMap = new Map<string, EvidenceItem>();

    for (const result of results) {
      const defaultCategory = result.category;
      const defaultDetectorId = `${result.category.toLowerCase()}_detector`;

      for (const item of result.evidence) {
        // Create deduplication key based on normalized description and snippet
        const normDesc = item.description.trim().toLowerCase();
        const normSnippet = (item.snippet || '').trim().toLowerCase();
        const dedupKey = `${item.source}::${normDesc}::${normSnippet}`;

        const itemCategory = item.detectorCategory || defaultCategory;
        const itemDetectorId = item.detectorId || defaultDetectorId;

        const currentContributor: EvidenceContributor = {
          category: itemCategory,
          detectorId: itemDetectorId,
        };

        const existing = aggregatedMap.get(dedupKey);

        if (!existing) {
          aggregatedMap.set(dedupKey, {
            id: item.id,
            source: item.source,
            description: item.description,
            snippet: item.snippet,
            relevanceScore: item.relevanceScore,
            detectorCategory: itemCategory,
            detectorId: itemDetectorId,
            contributingDetectors: [currentContributor],
          });
        } else {
          const existingContributors = existing.contributingDetectors || [];
          const alreadyContributed = existingContributors.some(
            (c) => c.category === itemCategory && c.detectorId === itemDetectorId,
          );
          const updatedContributors = alreadyContributed
            ? existingContributors
            : [...existingContributors, currentContributor];

          if (item.relevanceScore > existing.relevanceScore) {
            // Retain higher-relevance copy while preserving all aggregated contributors
            aggregatedMap.set(dedupKey, {
              id: item.id,
              source: item.source,
              description: item.description,
              snippet: item.snippet,
              relevanceScore: item.relevanceScore,
              detectorCategory: itemCategory,
              detectorId: itemDetectorId,
              contributingDetectors: updatedContributors,
            });
          } else {
            // Keep existing copy content but update contributingDetectors array immutably
            aggregatedMap.set(dedupKey, {
              ...existing,
              contributingDetectors: updatedContributors,
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
