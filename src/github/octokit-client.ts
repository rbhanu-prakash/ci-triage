import * as github from '@actions/github';
import { HistoricalRun, LogStreamProvider } from '../core/types.js';
import { createStringLogProvider } from '../core/log-provider.js';

export interface FailedJobDetails {
  jobId: number;
  jobName: string;
  stepName: string;
}

export interface GitHubClient {
  getFailedJob(
    owner: string,
    repo: string,
    runId: number,
    preferredJobName?: string,
  ): Promise<FailedJobDetails | null>;
  getJobLogStream(owner: string, repo: string, jobId: number): Promise<LogStreamProvider>;
  getChangedFiles(owner: string, repo: string, pullNumber: number): Promise<string[]>;
  getHistoricalRuns(
    owner: string,
    repo: string,
    workflowNameOrId: string,
    currentRunId: number,
    depth: number,
  ): Promise<HistoricalRun[]>;
  postPRComment(owner: string, repo: string, pullNumber: number, body: string): Promise<void>;
}

export class OctokitClient implements GitHubClient {
  private octokit: ReturnType<typeof github.getOctokit>;

  constructor(token: string) {
    this.octokit = github.getOctokit(token);
  }

  async getFailedJob(
    owner: string,
    repo: string,
    runId: number,
    preferredJobName?: string,
  ): Promise<FailedJobDetails | null> {
    try {
      const response = await this.octokit.rest.actions.listJobsForWorkflowRun({
        owner,
        repo,
        run_id: runId,
        per_page: 100,
      });

      const jobs = response.data.jobs || [];
      const failedJobs = jobs.filter(
        (j) =>
          j.conclusion === 'failure' ||
          j.conclusion === 'timed_out' ||
          j.conclusion === 'cancelled' ||
          (j.status === 'completed' &&
            j.conclusion &&
            j.conclusion !== 'success' &&
            j.conclusion !== 'skipped'),
      );

      if (failedJobs.length === 0) {
        return null;
      }

      const selectedJob =
        (preferredJobName ? failedJobs.find((j) => j.name === preferredJobName) : undefined) ||
        failedJobs[0];

      let failedStepName = 'Unknown Step';
      if (selectedJob.steps) {
        const failedStep = selectedJob.steps.find(
          (s) =>
            s.conclusion === 'failure' ||
            s.conclusion === 'timed_out' ||
            s.conclusion === 'cancelled',
        );
        if (failedStep) {
          failedStepName = failedStep.name;
        }
      }

      return {
        jobId: selectedJob.id,
        jobName: selectedJob.name,
        stepName: failedStepName,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`GitHub API failure listing jobs for run ${runId}: ${msg}`);
    }
  }

  async getJobLogStream(owner: string, repo: string, jobId: number): Promise<LogStreamProvider> {
    try {
      const response = await this.octokit.rest.actions.downloadJobLogsForWorkflowRun({
        owner,
        repo,
        job_id: jobId,
      });

      let content = '';
      if (typeof response.data === 'string') {
        content = response.data;
      } else if (response.data instanceof ArrayBuffer) {
        content = Buffer.from(response.data).toString('utf-8');
      } else if (Buffer.isBuffer(response.data)) {
        content = response.data.toString('utf-8');
      } else if (
        response.data &&
        typeof (response.data as { toString(): string }).toString === 'function'
      ) {
        content = (response.data as { toString(): string }).toString();
      }

      return createStringLogProvider(content);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`GitHub API failure fetching logs for job ${jobId}: ${msg}`);
    }
  }

  async getChangedFiles(owner: string, repo: string, pullNumber: number): Promise<string[]> {
    if (!pullNumber) return [];
    try {
      const response = await this.octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number: pullNumber,
        per_page: 100,
      });

      return (response.data || []).map((file) =>
        file.filename.replace(/\\/g, '/').replace(/^\.\//, ''),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`GitHub API failure fetching changed files for PR #${pullNumber}: ${msg}`);
    }
  }

  async getHistoricalRuns(
    owner: string,
    repo: string,
    _workflowNameOrId: string,
    currentRunId: number,
    depth: number,
  ): Promise<HistoricalRun[]> {
    if (depth <= 0) return [];
    try {
      const response = await this.octokit.rest.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        per_page: Math.min(depth + 10, 100),
      });

      const runs = response.data.workflow_runs || [];
      return runs
        .filter((r) => r.id !== currentRunId)
        .slice(0, depth)
        .map((r) => ({
          runId: r.id,
          workflowId: String(r.workflow_id),
          commitSha: r.head_sha || '',
          conclusion:
            r.conclusion === 'success'
              ? 'success'
              : r.conclusion === 'cancelled'
                ? 'cancelled'
                : 'failure',
          createdAt: r.created_at || new Date().toISOString(),
          fingerprints: [],
        }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`GitHub API failure fetching historical runs: ${msg}`);
    }
  }

  async postPRComment(
    owner: string,
    repo: string,
    pullNumber: number,
    body: string,
  ): Promise<void> {
    try {
      await this.octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: pullNumber,
        body,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`GitHub API failure posting comment on PR #${pullNumber}: ${msg}`);
    }
  }
}
