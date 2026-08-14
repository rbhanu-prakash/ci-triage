import * as github from '@actions/github';
import { HistoricalRun, LogStreamProvider } from '../core/types.js';
import { GitHubLogStreamProvider } from './log-stream.js';
import { parseLogStream } from '../parser/stream-parser.js';
import { DEFAULT_ANALYSIS_CONFIG } from '../core/classifier.js';

export interface FailedJobDetails {
  jobId: number;
  jobName: string;
  stepName: string;
  conclusion: 'failure' | 'timed_out' | 'cancelled' | string;
}

export interface HistoricalRunsQuery {
  workflowId?: string;
  workflowPath?: string;
  workflowName?: string;
}

/**
 * Resolves the primary workflow identifier following strict priority:
 * 1. workflowId (most precise, unique numerical ID as string)
 * 2. workflowPath (relative workflow YAML path, e.g., ".github/workflows/ci.yml")
 * 3. workflowName (human-readable workflow name)
 *
 * Never fabricates an identifier when all are absent or undefined.
 */
export function resolveWorkflowIdentifier(query: string | HistoricalRunsQuery | undefined): {
  identifier: string;
  source: 'workflowId' | 'workflowPath' | 'workflowName' | 'none';
} {
  if (!query) {
    return { identifier: '', source: 'none' };
  }
  if (typeof query === 'string') {
    const trimmed = query.trim();
    if (!trimmed) return { identifier: '', source: 'none' };
    if (/^\d+$/.test(trimmed)) {
      return { identifier: trimmed, source: 'workflowId' };
    }
    if (
      trimmed.endsWith('.yml') ||
      trimmed.endsWith('.yaml') ||
      trimmed.includes('/') ||
      trimmed.includes('\\')
    ) {
      return { identifier: trimmed, source: 'workflowPath' };
    }
    return { identifier: trimmed, source: 'workflowName' };
  }

  if (typeof query === 'object') {
    if (query.workflowId && query.workflowId.trim()) {
      return { identifier: query.workflowId.trim(), source: 'workflowId' };
    }
    if (query.workflowPath && query.workflowPath.trim()) {
      return { identifier: query.workflowPath.trim(), source: 'workflowPath' };
    }
    if (query.workflowName && query.workflowName.trim()) {
      return { identifier: query.workflowName.trim(), source: 'workflowName' };
    }
  }

  return { identifier: '', source: 'none' };
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
    workflowQuery: string | HistoricalRunsQuery,
    currentRunId: number,
    depth: number,
  ): Promise<HistoricalRun[]>;
  postPRComment(owner: string, repo: string, pullNumber: number, body: string): Promise<void>;
}

export class OctokitClient implements GitHubClient {
  private octokit: ReturnType<typeof github.getOctokit>;
  private token: string;

  constructor(token: string) {
    this.token = token;
    this.octokit = github.getOctokit(token);
  }

  /**
   * Deterministically selects the job whose failure should be analyzed.
   * Priority:
   * 1. Explicitly preferred job (if failed or timed_out)
   * 2. Failed job (conclusion === 'failure', sorted deterministically by start time/id)
   * 3. Timed out job (conclusion === 'timed_out')
   * 4. Cancelled job (conclusion === 'cancelled')
   */
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
      if (jobs.length === 0) {
        return null;
      }

      // Check preferred job first
      if (preferredJobName) {
        const preferred = jobs.find((j) => j.name === preferredJobName);
        if (
          preferred &&
          (preferred.conclusion === 'failure' ||
            preferred.conclusion === 'timed_out' ||
            preferred.conclusion === 'cancelled')
        ) {
          return this.formatJobDetails(preferred);
        }
      }

      // 1. Explicit 'failure' jobs (sorted deterministically by started_at ascending, then id ascending)
      const failedJobs = jobs
        .filter((j) => j.conclusion === 'failure')
        .sort((a, b) => {
          const timeA = a.started_at ? new Date(a.started_at).getTime() : 0;
          const timeB = b.started_at ? new Date(b.started_at).getTime() : 0;
          return timeA !== timeB ? timeA - timeB : a.id - b.id;
        });

      if (failedJobs.length > 0) {
        return this.formatJobDetails(failedJobs[0]);
      }

      // 2. Explicit 'timed_out' jobs
      const timedOutJobs = jobs
        .filter((j) => j.conclusion === 'timed_out')
        .sort((a, b) => a.id - b.id);

      if (timedOutJobs.length > 0) {
        return this.formatJobDetails(timedOutJobs[0]);
      }

      // 3. Explicit 'cancelled' jobs
      const cancelledJobs = jobs
        .filter((j) => j.conclusion === 'cancelled')
        .sort((a, b) => a.id - b.id);

      if (cancelledJobs.length > 0) {
        return this.formatJobDetails(cancelledJobs[0]);
      }

      // 4. Other completed non-successful jobs
      const otherUnsuccessful = jobs
        .filter(
          (j) =>
            j.status === 'completed' &&
            j.conclusion &&
            j.conclusion !== 'success' &&
            j.conclusion !== 'skipped',
        )
        .sort((a, b) => a.id - b.id);

      if (otherUnsuccessful.length > 0) {
        return this.formatJobDetails(otherUnsuccessful[0]);
      }

      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`GitHub API failure listing jobs for run ${runId}: ${msg}`);
    }
  }

  private formatJobDetails(job: {
    id: number;
    name: string;
    conclusion: string | null;
    steps?: Array<{ name: string; conclusion: string | null }>;
  }): FailedJobDetails {
    let failedStepName = 'Unknown Step';
    if (job.steps && job.steps.length > 0) {
      const failedStep = job.steps.find(
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
      jobId: job.id,
      jobName: job.name,
      stepName: failedStepName,
      conclusion: job.conclusion || 'failure',
    };
  }

  /**
   * Fetches the job log stream without buffering the entire log into memory.
   * Cancels the underlying response stream reader upon early termination.
   */
  async getJobLogStream(owner: string, repo: string, jobId: number): Promise<LogStreamProvider> {
    const url = `https://api.github.com/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`;
    let estimatedSize: number | undefined;

    const streamFactory = async function* (token: string): AsyncIterable<Uint8Array> {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'CI-Triage-Action',
        },
        redirect: 'follow',
      });

      if (!response.ok) {
        throw new Error(
          `GitHub API failure fetching logs for job ${jobId}: HTTP ${response.status} ${response.statusText}`,
        );
      }

      const contentLength = response.headers.get('content-length');
      if (contentLength) {
        const parsed = parseInt(contentLength, 10);
        if (!isNaN(parsed)) estimatedSize = parsed;
      }

      if (!response.body) {
        return;
      }

      const reader = response.body.getReader();
      let completedNaturally = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            completedNaturally = true;
            break;
          }
          if (value) yield value;
        }
      } finally {
        if (!completedNaturally) {
          try {
            await reader.cancel();
          } catch {
            // Ignore cancellation errors
          }
        }
        reader.releaseLock();
      }
    };

    return new GitHubLogStreamProvider(() => streamFactory(this.token), estimatedSize);
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

  /**
   * Retrieves historical runs for the SAME workflow and extracts failure fingerprints.
   */
  async getHistoricalRuns(
    owner: string,
    repo: string,
    workflowQuery: string | HistoricalRunsQuery,
    currentRunId: number,
    depth: number,
  ): Promise<HistoricalRun[]> {
    if (depth <= 0) return [];

    const { identifier: primaryWorkflowIdentifier, source: identifierSource } =
      resolveWorkflowIdentifier(workflowQuery);

    try {
      let rawRuns: Array<{
        id: number;
        name?: string | null;
        path?: string;
        workflow_id: number;
        head_sha: string;
        conclusion: string | null;
        created_at: string;
      }> = [];

      // Attempt targeted workflow runs API using highest-priority identifier (workflowId > workflowPath)
      if (identifierSource === 'workflowId' || identifierSource === 'workflowPath') {
        try {
          const response = await this.octokit.rest.actions.listWorkflowRuns({
            owner,
            repo,
            workflow_id: primaryWorkflowIdentifier,
            per_page: Math.min(depth + 10, 100),
          });
          rawRuns = response.data.workflow_runs;
        } catch {
          // Fall through to repository listing on 404/failure
        }
      }

      if (rawRuns.length === 0) {
        const response = await this.octokit.rest.actions.listWorkflowRunsForRepo({
          owner,
          repo,
          per_page: Math.min(depth + 15, 100),
        });
        rawRuns = (response.data.workflow_runs || []).filter((r) => {
          if (identifierSource === 'workflowId') {
            return String(r.workflow_id) === primaryWorkflowIdentifier;
          }
          if (identifierSource === 'workflowPath') {
            return Boolean(
              r.path &&
              (r.path === primaryWorkflowIdentifier || r.path.includes(primaryWorkflowIdentifier)),
            );
          }
          if (identifierSource === 'workflowName') {
            return r.name === primaryWorkflowIdentifier;
          }
          if (primaryWorkflowIdentifier) {
            return (
              r.name === primaryWorkflowIdentifier ||
              String(r.workflow_id) === primaryWorkflowIdentifier ||
              Boolean(r.path && r.path.includes(primaryWorkflowIdentifier))
            );
          }
          return true;
        });
      }

      // Filter out current run, enforce valid timestamps, and slice to requested depth
      const selectedRuns = rawRuns
        .filter((r) => r.id !== currentRunId && r.created_at)
        .slice(0, depth);

      const historicalRuns: HistoricalRun[] = [];

      for (const run of selectedRuns) {
        const conclusion: 'success' | 'failure' | 'cancelled' =
          run.conclusion === 'success'
            ? 'success'
            : run.conclusion === 'cancelled'
              ? 'cancelled'
              : 'failure';

        let fingerprints: string[] = [];

        // For failed runs, attempt bounded extraction of canonical error fingerprints
        if (conclusion === 'failure') {
          try {
            const failedJob = await this.getFailedJob(owner, repo, run.id);
            if (failedJob) {
              const logProvider = await this.getJobLogStream(owner, repo, failedJob.jobId);
              const parseResult = await parseLogStream(logProvider, {
                ...DEFAULT_ANALYSIS_CONFIG,
                maxLogSizeBytes: 2 * 1024 * 1024, // Bounded 2MB limit for historical logs
              });
              fingerprints = parseResult.frames.map((f) => f.fingerprint.canonicalHash);
            }
          } catch {
            // Degraded historical run log parsing; continue without failing the primary analysis
            fingerprints = [];
          }
        }

        historicalRuns.push({
          runId: run.id,
          workflowId: String(run.workflow_id),
          commitSha: run.head_sha || '',
          conclusion,
          createdAt: run.created_at,
          fingerprints,
        });
      }

      return historicalRuns;
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
