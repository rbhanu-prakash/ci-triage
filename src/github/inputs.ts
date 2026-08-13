import { AnalysisConfig } from '../core/types.js';
import { DEFAULT_ANALYSIS_CONFIG } from '../core/classifier.js';

export interface ActionInputs {
  githubToken: string;
  config: AnalysisConfig;
}

export function parseActionInputs(
  inputGetter: (name: string) => string = (name) => {
    // Standard process.env / fallback reader if needed in actions
    const envVar = `INPUT_${name.replace(/ /g, '_').toUpperCase()}`;
    return process.env[envVar] || '';
  },
): ActionInputs {
  const token = inputGetter('github-token')?.trim();
  if (!token) {
    throw new Error('Invalid input "github-token": GitHub token is required.');
  }

  const historyDepthRaw = inputGetter('history-depth');
  const historyDepth =
    historyDepthRaw !== '' ? Number(historyDepthRaw) : DEFAULT_ANALYSIS_CONFIG.historyDepth;
  if (!Number.isInteger(historyDepth) || historyDepth < 0) {
    throw new Error(
      `Invalid input "history-depth": expected non-negative integer, got "${historyDepthRaw}".`,
    );
  }

  const commentOnPRRaw = inputGetter('comment-on-pr');
  let commentOnPR = DEFAULT_ANALYSIS_CONFIG.commentOnPR;
  if (commentOnPRRaw !== '') {
    const val = commentOnPRRaw.toLowerCase().trim();
    if (val === 'true') {
      commentOnPR = true;
    } else if (val === 'false') {
      commentOnPR = false;
    } else {
      throw new Error(
        `Invalid input "comment-on-pr": expected "true" or "false", got "${commentOnPRRaw}".`,
      );
    }
  }

  const parseBoundedInt = (name: string, defaultVal: number): number => {
    const raw = inputGetter(name);
    if (raw === '') return defaultVal;
    const num = Number(raw);
    if (!Number.isInteger(num) || num < 0 || num > 100) {
      throw new Error(
        `Invalid input "${name}": expected an integer between 0 and 100, got "${raw}".`,
      );
    }
    return num;
  };

  const unknownThreshold = parseBoundedInt(
    'unknown-threshold',
    DEFAULT_ANALYSIS_CONFIG.unknownThreshold,
  );
  const minFlakyConfidence = parseBoundedInt(
    'min-flaky-confidence',
    DEFAULT_ANALYSIS_CONFIG.minFlakyConfidence,
  );
  const minRegressionConfidence = parseBoundedInt(
    'min-regression-confidence',
    DEFAULT_ANALYSIS_CONFIG.minRegressionConfidence,
  );

  return {
    githubToken: token,
    config: {
      ...DEFAULT_ANALYSIS_CONFIG,
      historyDepth,
      commentOnPR,
      unknownThreshold,
      minFlakyConfidence,
      minRegressionConfidence,
    },
  };
}
