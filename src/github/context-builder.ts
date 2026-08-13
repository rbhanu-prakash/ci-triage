import {
  AnalysisConfig,
  AnalysisContext,
  HistoricalRun,
  LogStreamProvider,
} from '../core/types.js';
import { createStringLogProvider } from '../core/log-provider.js';
import { EventContext } from './event-context.js';
import { GitHubClient } from './octokit-client.js';

export async function buildAnalysisContext(
  eventContext: EventContext,
  config: AnalysisConfig,
  client: GitHubClient,
): Promise<AnalysisContext> {
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
        } catch {
          logProvider = createStringLogProvider('');
        }
      }
    } catch {
      // Ignore API failure for job resolution; fallbacks remain in place
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
    } catch {
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
    } catch {
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
