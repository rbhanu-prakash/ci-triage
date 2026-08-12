import { AnalysisContext, DetectorResult, FailureCategory, EvidenceItem } from '../core/types.js';
import { LogParseResult } from '../parser/stream-parser.js';

export interface DetectorInput {
  context: AnalysisContext;
  parseResult: LogParseResult;
}

export interface Detector {
  readonly id: string;
  readonly category: FailureCategory;
  detect(input: DetectorInput): DetectorResult | null;
}

/**
 * Helper function to create an EvidenceItem with standardized fields.
 */
export function createEvidenceItem(
  id: string,
  source: EvidenceItem['source'],
  description: string,
  relevanceScore: number,
  snippet?: string,
): EvidenceItem {
  return {
    id,
    source,
    description,
    relevanceScore,
    snippet: snippet ? snippet.trim() : undefined,
  };
}
