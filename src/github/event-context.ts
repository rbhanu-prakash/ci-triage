export interface EventContext {
  owner: string;
  repo: string;
  runId: number;
  workflowName: string;
  jobName: string;
  sha: string;
  ref: string;
  eventName: string;
  pullNumber?: number;
}

export function extractEventContext(rawContext: unknown): EventContext {
  const ctx = (rawContext || {}) as Record<string, unknown>;
  const repo = (ctx.repo || {}) as { owner?: string; repo?: string };
  const payload = (ctx.payload || {}) as Record<string, unknown>;
  const repository = (payload.repository || {}) as { owner?: { login?: string }; name?: string };

  const repoOwner = repo.owner || repository.owner?.login || '';
  const repoName = repo.repo || repository.name || '';
  const eventName = typeof ctx.eventName === 'string' ? ctx.eventName : '';

  const pullRequest = payload.pull_request as
    { number?: number; head?: { sha?: string } } | undefined;
  const issue = payload.issue as { number?: number; pull_request?: unknown } | undefined;

  let runId = typeof ctx.runId === 'number' ? ctx.runId : 0;
  let workflowName = typeof ctx.workflow === 'string' ? ctx.workflow : 'Unknown Workflow';
  let sha = pullRequest?.head?.sha || (typeof ctx.sha === 'string' ? ctx.sha : '');
  let ref = typeof ctx.ref === 'string' ? ctx.ref : '';
  let pullNumber: number | undefined;

  // Extract PR association from event payload if available
  if (pullRequest?.number) {
    pullNumber = Number(pullRequest.number);
  } else if (issue?.number && issue.pull_request) {
    pullNumber = Number(issue.number);
  }

  // Support workflow_run event model
  const workflowRun = payload.workflow_run as
    | {
        id?: number;
        name?: string;
        head_sha?: string;
        head_branch?: string;
        pull_requests?: Array<{ number?: number }>;
      }
    | undefined;

  if (eventName === 'workflow_run' && workflowRun) {
    if (typeof workflowRun.id === 'number') {
      runId = workflowRun.id;
    }
    if (workflowRun.name) {
      workflowName = workflowRun.name;
    }
    if (workflowRun.head_sha) {
      sha = workflowRun.head_sha;
    }
    if (workflowRun.head_branch) {
      ref = workflowRun.head_branch;
    }
    if (
      !pullNumber &&
      Array.isArray(workflowRun.pull_requests) &&
      workflowRun.pull_requests.length > 0
    ) {
      if (typeof workflowRun.pull_requests[0].number === 'number') {
        pullNumber = workflowRun.pull_requests[0].number;
      }
    }
  } else if (!sha && pullRequest?.head?.sha) {
    sha = pullRequest.head.sha;
  }

  const jobName = typeof ctx.job === 'string' ? ctx.job : 'unknown-job';

  return {
    owner: repoOwner,
    repo: repoName,
    runId,
    workflowName,
    jobName,
    sha,
    ref,
    eventName,
    pullNumber,
  };
}
