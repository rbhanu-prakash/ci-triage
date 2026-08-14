import {
  AnalysisConfig,
  AnalysisContext,
  HistoricalRun,
  LogStreamProvider,
} from '../core/types.js';
import { createStringLogProvider } from '../core/log-provider.js';
import { EventContext } from './event-context.js';
import { GitHubClient } from './octokit-client.js';

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
  let jobName = eventContext.jobName || 'unknown-job';
  let stepName = 'unknown-step';
  let logProvider: LogStreamProvider = createStringLogProvider('');

  if (eventContext.owner && eventContext.repo && eventContext.runId) {
    try {
      const failedJob = await client.getFailedJob(
        eventContext.owner,
        eventContext.repo,
        eventContext.runId,
        eventContext.jobName,
      );

      if (failedJob) {
        jobName = failedJob.jobName;
        stepName = failedJob.stepName;
        try {
          logProvider = await client.getJobLogStream(
            eventContext.owner,
            eventContext.repo,
            failedJob.jobId,
          );
        } catch (logErr) {
          const msg = logErr instanceof Error ? logErr.message : String(logErr);
          warningLogger(`Failed to fetch log stream for job ${failedJob.jobId}: ${msg}`);
          logProvider = createStringLogProvider('');
        }
      } else {
        warningLogger(`No eligible failed job could be identified for run ${eventContext.runId}.`);
      }
    } catch (jobErr) {
      const msg = jobErr instanceof Error ? jobErr.message : String(jobErr);
      warningLogger(`Failed to resolve failed job for run ${eventContext.runId}: ${msg}`);
    }
  }

  let changedFiles: string[] = [];
  if (eventContext.owner && eventContext.repo && eventContext.pullNumber) {
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

  let historicalRuns: HistoricalRun[] = [];
  if (eventContext.owner && eventContext.repo && eventContext.runId && config.historyDepth > 0) {
    try {
      historicalRuns = await client.getHistoricalRuns(
        eventContext.owner,
        eventContext.repo,
        eventContext.workflowName,
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
