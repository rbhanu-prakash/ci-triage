/**
 * Core Domain Models and Interfaces for CI Triage
 */

export type FailureCategory =
  | 'CODE_REGRESSION'
  | 'TEST_FAILURE'
  | 'FLAKY_TEST'
  | 'DEPENDENCY'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'CONFIGURATION'
  | 'PERMISSION'
  | 'BUILD'
  | 'RESOURCE'
  | 'UNKNOWN';

export interface AnalysisConfig {
  /** Number of historical workflow runs to analyze for fingerprint comparison (default: 10) */
  historyDepth: number;
  /** Minimum confidence score % required; defaults to UNKNOWN if max confidence is below (default: 50) */
  unknownThreshold: number;
  /** Minimum confidence % required for FLAKY_TEST classification (default: 75) */
  minFlakyConfidence: number;
  /** Minimum confidence % required for CODE_REGRESSION classification (default: 80) */
  minRegressionConfidence: number;
  /** Maximum log size in bytes allowed for processing (default: 10MB) */
  maxLogSizeBytes: number;
  /** Whether to post a summary comment to the PR (requires pull-requests: write permission) */
  commentOnPR: boolean;
  /** Custom user secret patterns to sanitize */
  customSecretPatterns: string[];
}

export interface LogStreamProvider {
  /** Stream log line chunks iteratively without buffering entire log into memory */
  getLineStream(): AsyncIterable<string>;
  /** Total estimated size of the log stream in bytes (returns undefined if unavailable without consuming the stream) */
  getEstimatedSizeBytes(): Promise<number | undefined>;
}

export interface FailureFingerprint {
  /** Canonical hash (SHA-256) of normalized error string */
  canonicalHash: string;
  /** Original error string prior to normalization */
  rawErrorLine: string;
  /** Error line with dynamic entities (IPs, UUIDs, hex, timestamps) stripped */
  normalizedErrorLine: string;
  /** File path and line number if identified (e.g. "src/auth/login.test.ts:42") */
  fileLocation?: string;
}

export interface HistoricalRun {
  runId: number;
  workflowId: string;
  commitSha: string;
  conclusion: 'success' | 'failure' | 'cancelled';
  createdAt: string;
  /** List of canonical fingerprint hashes observed in this historical run */
  fingerprints: string[];
}

export interface AnalysisContext {
  workflowName: string;
  runId: number;
  jobName: string;
  stepName: string;
  /** Bounded log stream provider abstraction */
  logProvider: LogStreamProvider;
  /** File paths modified in the pull request or commit */
  changedFiles: string[];
  /** Past N runs of the workflow for cross-run fingerprint matching */
  historicalRuns: HistoricalRun[];
  /** Execution environment metadata */
  environment: {
    runnerOs: string;
    nodeVersion?: string;
  };
  /** Configuration settings for analysis thresholds and boundaries */
  config: AnalysisConfig;
}

export interface EvidenceItem {
  id: string;
  source: 'log_signature' | 'exit_code' | 'diff_correlation' | 'history_match' | 'system_event';
  description: string;
  snippet?: string;
  relevanceScore: number; // 0 - 100
}

export interface DetectorResult {
  category: FailureCategory;
  confidenceScore: number; // 0 - 100
  evidence: EvidenceItem[];
  fingerprint?: FailureFingerprint;
  suggestedAction?: string;
}

export interface TriageReport {
  classification: FailureCategory;
  confidence: number;
  fingerprint?: FailureFingerprint;
  observedEvidence: EvidenceItem[];
  inferenceDetails: string;
  recommendedAction: string;
  jobName: string;
  stepName: string;
  metadata: {
    historyAnalyzed: number;
    logBytesProcessed: number;
    durationMs: number;
  };
}
