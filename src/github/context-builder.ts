import {
  AnalysisConfig,
  AnalysisContext,
  HistoricalRun,
  LogStreamProvider,
} from '../core/types.js';
import { EventContext } from './event-context.js';
import { GitHubClient, HistoricalRunsQuery } from './octokit-client.js';

export interface ContextBuilderOptions {
  warningLogger?: (message: string) => void;
}

export async function buildAnalysisContext(
  eventContext: EventContext,
  config: AnalysisConfig,
  client: GitHubClient,
  options: ContextBuilderOptions = {},
): Promise<AnalysisContext> {
  const warningLogger = options.warningLogger || (() => {});

  if (!eventContext.owner || !eventContext.repo || !eventContext.runId) {
    throw new Error(
      `Insufficient repository or run context for CI Triage: owner="${eventContext.owner}", repo="${eventContext.repo}", runId=${eventContext.runId}.`,
    );
  }

  // 1. Identify the failed job to analyze (REQUIRED)
  let failedJob;
  try {
    failedJob = await client.getFailedJob(
      eventContext.owner,
      eventContext.repo,
      eventContext.runId,
      eventContext.jobName,
    );
  } catch (jobErr) {
    const msg = jobErr instanceof Error ? jobErr.message : String(jobErr);
    throw new Error(`Failed to list workflow jobs for run ${eventContext.runId}: ${msg}`);
  }

  if (!failedJob) {
    throw new Error(
      `No eligible failed, timed out, or unsuccessful job was found for run ${eventContext.runId} to analyze.`,
    );
  }

  const jobName = failedJob.jobName;
  const stepName = failedJob.stepName;

  // 2. Fetch the failure log stream (REQUIRED - must not silently degrade to empty string)
  let logProvider: LogStreamProvider;
  try {
    logProvider = await client.getJobLogStream(
      eventContext.owner,
      eventContext.repo,
      failedJob.jobId,
    );
  } catch (logErr) {
    const msg = logErr instanceof Error ? logErr.message : String(logErr);
    throw new Error(
      `Failed to retrieve job log stream for failed job "${jobName}" (job ID: ${failedJob.jobId}): ${msg}`,
    );
  }

  // 3. Optional Changed Files evidence (gracefully degrades with warning)
  let changedFiles: string[] = [];
  if (eventContext.pullNumber) {
    try {
      changedFiles = await client.getChangedFiles(
        eventContext.owner,
        eventContext.repo,
        eventContext.pullNumber,
      );
    } catch (fileErr) {
      const msg = fileErr instanceof Error ? fileErr.message : String(fileErr);
      warningLogger(
        `Failed to retrieve changed files for PR #${eventContext.pullNumber} (${msg}); CODE_REGRESSION evidence degraded.`,
      );
      changedFiles = [];
    }
  }

  // 4. Optional Historical Runs evidence (gracefully degrades with warning)
  let historicalRuns: HistoricalRun[] = [];
  if (config.historyDepth > 0) {
    const workflowQuery: HistoricalRunsQuery = {
      workflowId: eventContext.workflowId,
      workflowPath: eventContext.workflowPath,
      workflowName: eventContext.workflowName,
    };

    try {
      historicalRuns = await client.getHistoricalRuns(
        eventContext.owner,
        eventContext.repo,
        workflowQuery,
        eventContext.runId,
        config.historyDepth,
      );
    } catch (histErr) {
      const msg = histErr instanceof Error ? histErr.message : String(histErr);
      warningLogger(
        `Failed to retrieve historical runs for workflow "${eventContext.workflowName}" (${msg}); FLAKY_TEST evidence degraded.`,
      );
      historicalRuns = [];
    }
  }

  return {
    workflowName: eventContext.workflowName,
    runId: eventContext.runId,
    jobName,
    stepName,
    logProvider,
    changedFiles,
    historicalRuns,
    environment: {
      runnerOs: process.env.RUNNER_OS || 'Linux',
      nodeVersion: process.version,
    },
    config,
  };
}
