import {
  AnalysisConfig,
  AnalysisContext,
  DetectorResult,
  EvidenceItem,
  FailureCategory,
  SecondarySignal,
  TriageReport,
} from './types.js';
import { EvidenceEngine } from './evidence-engine.js';

export const DEFAULT_ANALYSIS_CONFIG: AnalysisConfig = {
  historyDepth: 10,
  unknownThreshold: 50,
  minFlakyConfidence: 75,
  minRegressionConfidence: 80,
  maxLogSizeBytes: 10 * 1024 * 1024,
  commentOnPR: false,
  customSecretPatterns: [],
};

const RECOMMENDED_ACTIONS: Record<FailureCategory, string> = {
  NETWORK: 'Verify endpoint availability, DNS, proxies, or transient service failures.',
  DEPENDENCY: 'Review package/version constraints and lockfile consistency.',
  TIMEOUT: 'Inspect slow steps and timeout configuration.',
  PERMISSION: 'Verify token scopes, credentials, and repository permissions.',
  BUILD: 'Inspect compiler/build errors and affected source files.',
  TEST_FAILURE: 'Inspect failing test and assertion.',
  FLAKY_TEST: 'Investigate test isolation, race conditions, timing, or nondeterministic state.',
  CODE_REGRESSION: 'Inspect recent changes correlated with the failure.',
  CONFIGURATION: 'Review workflow/configuration/secrets.',
  RESOURCE: 'Check runner memory, disk space, and resource limits.',
  UNKNOWN: 'Manually inspect the relevant failure frame and surrounding logs.',
};

export class Classifier {
  private evidenceEngine = new EvidenceEngine();

  /**
   * Classifies a set of detector results into a single TriageReport.
   */
  public classify(results: DetectorResult[], context?: Partial<AnalysisContext>): TriageReport {
    const config: AnalysisConfig = {
      ...DEFAULT_ANALYSIS_CONFIG,
      ...(context?.config || {}),
    };

    const jobName = context?.jobName || 'unknown_job';
    const stepName = context?.stepName || 'unknown_step';

    // 1. Aggregate and deduplicate evidence without mutating inputs
    const observedEvidence = this.evidenceEngine.aggregate(results);

    // 2. Filter candidate detectors (ignore UNKNOWN or 0 confidence)
    const validCandidates = results.filter(
      (r) => r.category !== 'UNKNOWN' && r.confidenceScore > 0,
    );

    if (validCandidates.length === 0) {
      return this.buildUnknownReport(
        observedEvidence,
        config,
        jobName,
        stepName,
        'No deterministic error signatures were detected in the failure log.',
      );
    }

    // 3. Resolve conflicts among candidate signals
    const { primary, secondary, conflictPenalty, resolutionReason } = this.resolveConflicts(
      validCandidates,
      config,
    );

    // 4. Calculate deterministic evidence-strength confidence score
    const rawConfidence = this.calculateConfidenceScore(
      primary,
      observedEvidence,
      validCandidates,
      conflictPenalty,
    );

    // 5. Apply unknownThreshold
    if (rawConfidence < config.unknownThreshold) {
      const reason =
        resolutionReason ||
        `Detector confidence (${rawConfidence}) fell below the required threshold (${config.unknownThreshold}).`;
      return this.buildUnknownReport(
        observedEvidence,
        config,
        jobName,
        stepName,
        reason,
        rawConfidence,
        secondary,
      );
    }

    // 6. Build Inference Details string
    const inferenceDetails = this.buildInferenceDetails(primary, resolutionReason);

    // 7. Find primary fingerprint
    const primaryFingerprint =
      primary.fingerprint || results.find((r) => r.fingerprint)?.fingerprint;

    // 8. Construct final TriageReport
    return {
      classification: primary.category,
      confidence: rawConfidence,
      fingerprint: primaryFingerprint,
      observedEvidence,
      inferenceDetails,
      recommendedAction: RECOMMENDED_ACTIONS[primary.category] || RECOMMENDED_ACTIONS.UNKNOWN,
      jobName,
      stepName,
      secondarySignals: secondary.length > 0 ? secondary : undefined,
      metadata: {
        historyAnalyzed: context?.historicalRuns?.length || 0,
        logBytesProcessed: 0,
        durationMs: 0,
      },
    };
  }

  /**
   * Evaluates multiple candidate results to select the primary category and secondary signals.
   */
  private resolveConflicts(
    candidates: DetectorResult[],
    config: AnalysisConfig,
  ): {
    primary: DetectorResult;
    secondary: SecondarySignal[];
    conflictPenalty: number;
    resolutionReason: string;
  } {
    // Sort candidates descending by confidence
    const sorted = [...candidates].sort((a, b) => b.confidenceScore - a.confidenceScore);

    let primary = sorted[0];
    let resolutionReason = '';
    let conflictPenalty = 0;

    const findCategory = (cat: FailureCategory) => sorted.find((c) => c.category === cat);

    const buildCand = findCategory('BUILD');
    const testCand = findCategory('TEST_FAILURE');
    const netCand = findCategory('NETWORK');
    const depCand = findCategory('DEPENDENCY');
    const flakyCand = findCategory('FLAKY_TEST');
    const regCand = findCategory('CODE_REGRESSION');

    // Conflict Rule A: BUILD vs TEST_FAILURE
    if (buildCand && testCand) {
      const isCompilerEvidence = buildCand.evidence.some((e) =>
        /compiler|tsc|esbuild|webpack|babel|vite|rollup|type\s*error|compilation\s*failed|transpile/i.test(
          e.description + ' ' + (e.snippet || ''),
        ),
      );
      const isWeakTestSignal = testCand.confidenceScore < 75;
      const isBuildMateriallyStronger = buildCand.confidenceScore >= testCand.confidenceScore + 10;

      if (isCompilerEvidence && isWeakTestSignal) {
        primary = buildCand;
        resolutionReason = `Selected BUILD as primary cause due to explicit compiler/bundler failure evidence overriding weak test failure signal (${testCand.confidenceScore}).`;
      } else if (isBuildMateriallyStronger) {
        primary = buildCand;
        if (sorted[0].category !== 'BUILD') {
          resolutionReason = `Selected BUILD as primary cause because build error signal (${buildCand.confidenceScore}) is materially stronger than test failure signal (${testCand.confidenceScore}).`;
        }
      } else if (testCand.confidenceScore >= buildCand.confidenceScore) {
        primary = testCand;
      }
    }
    // Conflict Rule B: Systemic NETWORK overriding weaker CODE_REGRESSION or TEST_FAILURE
    if (
      netCand &&
      netCand.confidenceScore >= 85 &&
      (primary.category === 'CODE_REGRESSION' || primary.category === 'TEST_FAILURE') &&
      primary.confidenceScore <= netCand.confidenceScore + 5
    ) {
      primary = netCand;
      resolutionReason = `Selected NETWORK as primary cause due to strong systemic infrastructure failure signature (${netCand.confidenceScore}) overriding code signal.`;
    }
    // Conflict Rule C: FLAKY_TEST priority over generic TEST_FAILURE when supported by strong historical evidence
    if (
      flakyCand &&
      flakyCand.confidenceScore >= config.minFlakyConfidence &&
      primary.category === 'TEST_FAILURE' &&
      flakyCand.confidenceScore >= (testCand?.confidenceScore || 0) - 10
    ) {
      primary = flakyCand;
      resolutionReason = `Selected FLAKY_TEST as primary cause due to historical non-deterministic pass/fail signature.`;
    }
    // Conflict Rule D: CODE_REGRESSION priority over generic TEST_FAILURE when confidence >= threshold
    if (
      regCand &&
      regCand.confidenceScore >= config.minRegressionConfidence &&
      primary.category === 'TEST_FAILURE' &&
      regCand.confidenceScore >= (testCand?.confidenceScore || 0) - 5
    ) {
      primary = regCand;
      resolutionReason = `Selected CODE_REGRESSION as primary cause due to direct correlation between PR diff and failure location.`;
    }
    // Conflict Rule E: DEPENDENCY vs NETWORK conflict handling
    if (depCand && netCand && Math.abs(depCand.confidenceScore - netCand.confidenceScore) <= 15) {
      const topChoice = depCand.confidenceScore >= netCand.confidenceScore ? depCand : netCand;
      if (primary.category === 'DEPENDENCY' || primary.category === 'NETWORK') {
        primary = topChoice;
      }
      conflictPenalty = 15;
      resolutionReason = `Conflict detected between DEPENDENCY (${depCand.confidenceScore}) and NETWORK (${netCand.confidenceScore}) signals. Apply conflict penalty.`;
    }

    // Identify close competitors for conflict penalty if not already set
    if (conflictPenalty === 0 && sorted.length > 1) {
      const runnerUp = sorted.find((c) => c.category !== primary.category);
      if (runnerUp && runnerUp.confidenceScore >= 75) {
        const diff = primary.confidenceScore - runnerUp.confidenceScore;
        if (diff <= 10) {
          conflictPenalty = 15;
          resolutionReason =
            resolutionReason ||
            `Strong competing signal detected for ${runnerUp.category} (${runnerUp.confidenceScore}).`;
        } else if (diff <= 20) {
          conflictPenalty = 10;
        }
      }
    }

    // Build secondary signals list for all non-primary categories
    const secondaryMap = new Map<FailureCategory, SecondarySignal>();
    for (const cand of sorted) {
      if (cand.category !== primary.category) {
        secondaryMap.set(cand.category, {
          category: cand.category,
          confidence: cand.confidenceScore,
          description: `Secondary signal detected with ${cand.evidence.length} evidence item(s).`,
        });
      }
    }

    return {
      primary,
      secondary: Array.from(secondaryMap.values()),
      conflictPenalty,
      resolutionReason,
    };
  }

  /**
   * Calculates evidence-strength confidence score capped at 100.
   */
  private calculateConfidenceScore(
    primary: DetectorResult,
    evidence: EvidenceItem[],
    candidates: DetectorResult[],
    conflictPenalty: number,
  ): number {
    let score = primary.confidenceScore;

    // 1. Primary Evidence Corroboration
    const primaryEvidence = evidence.filter(
      (e) =>
        e.detectorCategory === primary.category ||
        e.contributingDetectors?.some((c) => c.category === primary.category),
    );

    if (primaryEvidence.length > 1) {
      const bonus = Math.min(10, (primaryEvidence.length - 1) * 5);
      score += bonus;
    }

    // 2. Cross-Detector Corroboration:
    // Check for evidence items corroborated by multiple distinct detectors
    const multiDetectorEvidenceCount = primaryEvidence.filter(
      (e) => (e.contributingDetectors?.length || 0) > 1,
    ).length;
    if (multiDetectorEvidenceCount > 0) {
      score += Math.min(10, multiDetectorEvidenceCount * 5);
    }

    // Check for independent candidate detectors sharing the same non-empty fingerprint
    const matchingFingerprintCandidates = candidates.filter(
      (c) =>
        c.category !== primary.category &&
        Boolean(c.fingerprint) &&
        Boolean(primary.fingerprint) &&
        c.fingerprint === primary.fingerprint,
    );
    if (matchingFingerprintCandidates.length > 0) {
      score += Math.min(5, matchingFingerprintCandidates.length * 5);
    }

    // 3. Source Diversity: evidence spanning multiple distinct sources
    const sources = new Set(primaryEvidence.map((e) => e.source));
    if (sources.size >= 2) {
      score += 5;
    }

    // 4. Apply conflict penalty
    score -= conflictPenalty;

    // Strict cap at 100, floor at 0
    return Math.min(100, Math.max(0, score));
  }

  /**
   * Constructs concise classifier inference text without duplicating observed evidence.
   */
  private buildInferenceDetails(primary: DetectorResult, resolutionReason?: string): string {
    let inference = `The failure is most consistent with a ${primary.category.toLowerCase()} issue.`;
    if (resolutionReason) {
      inference += ` ${resolutionReason}`;
    }
    return inference;
  }

  /**
   * Constructs a standard report when classification falls below threshold or yields UNKNOWN.
   */
  private buildUnknownReport(
    observedEvidence: EvidenceItem[],
    _config: AnalysisConfig,
    jobName: string,
    stepName: string,
    reason: string,
    confidence = 0,
    secondarySignals: SecondarySignal[] = [],
  ): TriageReport {
    const inferenceDetails = `Classification is UNKNOWN. ${reason}`;

    return {
      classification: 'UNKNOWN',
      confidence,
      observedEvidence,
      inferenceDetails,
      recommendedAction: RECOMMENDED_ACTIONS.UNKNOWN,
      jobName,
      stepName,
      secondarySignals: secondarySignals.length > 0 ? secondarySignals : undefined,
      metadata: {
        historyAnalyzed: 0,
        logBytesProcessed: 0,
        durationMs: 0,
      },
    };
  }
}
