import { describe, it, expect } from 'vitest';
import { parseActionInputs } from '../../src/github/inputs.js';
import { extractEventContext } from '../../src/github/event-context.js';
import { buildAnalysisContext } from '../../src/github/context-builder.js';
import { FailedJobDetails, GitHubClient, OctokitClient } from '../../src/github/octokit-client.js';
import { runActionOrchestrator } from '../../src/action-entry.js';
import { createStringLogProvider } from '../../src/core/log-provider.js';
import { FIXTURES } from '../fixtures/index.js';
import { HistoricalRun, LogStreamProvider } from '../../src/core/types.js';

class MockGitHubClient implements GitHubClient {
  public failedJobResult: FailedJobDetails | null = {
    jobId: 101,
    jobName: 'build-and-test',
    stepName: 'Run tests',
    conclusion: 'failure',
  };
  public logContent: string = FIXTURES.jestAssertionFailure;
  public changedFilesResult: string[] = ['src/components/button.tsx'];
  public historicalRunsResult: HistoricalRun[] = [
    {
      runId: 900,
      workflowId: '123',
      commitSha: 'abc1234',
      conclusion: 'success',
      createdAt: '2026-08-12T00:00:00Z',
      fingerprints: [],
    },
  ];
  public postPRCommentCalls: Array<{ pullNumber: number; body: string }> = [];
  public shouldFailPRComment = false;
  public shouldFailJobFetch = false;
  public shouldFailChangedFiles = false;
  public shouldFailHistoricalRuns = false;

  async getFailedJob(
    _owner: string,
    _repo: string,
    _runId: number,
    preferredJobName?: string,
  ): Promise<FailedJobDetails | null> {
    if (this.shouldFailJobFetch) {
      throw new Error('API Rate Limit Exceeded (429)');
    }
    if (!this.failedJobResult) return null;
    return {
      ...this.failedJobResult,
      jobName: preferredJobName || this.failedJobResult.jobName,
    };
  }

  async getJobLogStream(_owner: string, _repo: string, _jobId: number): Promise<LogStreamProvider> {
    return createStringLogProvider(this.logContent);
  }

  async getChangedFiles(_owner: string, _repo: string, _pullNumber: number): Promise<string[]> {
    if (this.shouldFailChangedFiles) {
      throw new Error('Pulls API 404: Not Found');
    }
    return this.changedFilesResult;
  }

  async getHistoricalRuns(
    _owner: string,
    _repo: string,
    _workflowNameOrId: string,
    _currentRunId: number,
    _depth: number,
  ): Promise<HistoricalRun[]> {
    if (this.shouldFailHistoricalRuns) {
      throw new Error('Actions API 500: Internal Server Error');
    }
    return this.historicalRunsResult;
  }

  async postPRComment(
    _owner: string,
    _repo: string,
    pullNumber: number,
    body: string,
  ): Promise<void> {
    if (this.shouldFailPRComment) {
      throw new Error('HTTP 403 Forbidden: Resource not accessible by integration');
    }
    this.postPRCommentCalls.push({ pullNumber, body });
  }
}

describe('Phase 5 GitHub Integration', () => {
  describe('1 & 2. Action Input Parsing & Validation', () => {
    it('parses valid action inputs with defaults', () => {
      const getter = (name: string) => {
        if (name === 'github-token') return 'ghp_secret_token_12345';
        return '';
      };
      const result = parseActionInputs(getter);
      expect(result.githubToken).toBe('ghp_secret_token_12345');
      expect(result.config.historyDepth).toBe(10);
      expect(result.config.commentOnPR).toBe(false);
      expect(result.config.unknownThreshold).toBe(50);
      expect(result.config.minFlakyConfidence).toBe(75);
      expect(result.config.minRegressionConfidence).toBe(80);
    });

    it('parses custom valid inputs', () => {
      const getter = (name: string) => {
        const map: Record<string, string> = {
          'github-token': 'ghp_secret',
          'history-depth': '20',
          'comment-on-pr': 'true',
          'unknown-threshold': '60',
          'min-flaky-confidence': '80',
          'min-regression-confidence': '85',
        };
        return map[name] || '';
      };
      const result = parseActionInputs(getter);
      expect(result.config.historyDepth).toBe(20);
      expect(result.config.commentOnPR).toBe(true);
      expect(result.config.unknownThreshold).toBe(60);
      expect(result.config.minFlakyConfidence).toBe(80);
      expect(result.config.minRegressionConfidence).toBe(85);
    });

    it('throws when github-token is missing', () => {
      expect(() => parseActionInputs(() => '')).toThrow(
        'Invalid input "github-token": GitHub token is required.',
      );
    });

    it('throws when history-depth is negative or invalid', () => {
      expect(() =>
        parseActionInputs((name) => {
          if (name === 'github-token') return 'tok';
          if (name === 'history-depth') return '-5';
          return '';
        }),
      ).toThrow('Invalid input "history-depth"');

      expect(() =>
        parseActionInputs((name) => {
          if (name === 'github-token') return 'tok';
          if (name === 'history-depth') return 'invalid_number';
          return '';
        }),
      ).toThrow('Invalid input "history-depth"');
    });

    it('throws when comment-on-pr is not a valid boolean string', () => {
      expect(() =>
        parseActionInputs((name) => {
          if (name === 'github-token') return 'tok';
          if (name === 'comment-on-pr') return 'maybe';
          return '';
        }),
      ).toThrow('Invalid input "comment-on-pr": expected "true" or "false"');
    });

    it('throws when confidence thresholds are out of bounds', () => {
      expect(() =>
        parseActionInputs((name) => {
          if (name === 'github-token') return 'tok';
          if (name === 'unknown-threshold') return '150';
          return '';
        }),
      ).toThrow('Invalid input "unknown-threshold"');

      expect(() =>
        parseActionInputs((name) => {
          if (name === 'github-token') return 'tok';
          if (name === 'min-flaky-confidence') return '-10';
          return '';
        }),
      ).toThrow('Invalid input "min-flaky-confidence"');
    });
  });

  describe('3. GitHub Context Extraction', () => {
    it('maps standard pull_request event context', () => {
      const rawContext = {
        eventName: 'pull_request',
        runId: 1001,
        workflow: 'CI Workflow',
        job: 'test-job',
        sha: 'commit_sha_123',
        ref: 'refs/pull/42/merge',
        repo: { owner: 'acme', repo: 'app' },
        payload: {
          pull_request: {
            number: 42,
            head: { sha: 'pr_head_sha_456' },
          },
        },
      };

      const eventContext = extractEventContext(rawContext);
      expect(eventContext.owner).toBe('acme');
      expect(eventContext.repo).toBe('app');
      expect(eventContext.runId).toBe(1001);
      expect(eventContext.workflowName).toBe('CI Workflow');
      expect(eventContext.jobName).toBe('test-job');
      expect(eventContext.sha).toBe('pr_head_sha_456');
      expect(eventContext.pullNumber).toBe(42);
    });

    it('maps workflow_run event context', () => {
      const rawContext = {
        eventName: 'workflow_run',
        runId: 9999,
        workflow: 'Triage Workflow',
        job: 'triage-job',
        repo: { owner: 'acme', repo: 'app' },
        payload: {
          workflow_run: {
            id: 5005,
            name: 'Target App Build',
            head_sha: 'wf_target_sha',
            head_branch: 'feature-branch',
            pull_requests: [{ number: 99 }],
          },
        },
      };

      const eventContext = extractEventContext(rawContext);
      expect(eventContext.runId).toBe(5005);
      expect(eventContext.workflowName).toBe('Target App Build');
      expect(eventContext.sha).toBe('wf_target_sha');
      expect(eventContext.ref).toBe('feature-branch');
      expect(eventContext.pullNumber).toBe(99);
    });

    it('maps push event context without fabricating PR numbers', () => {
      const rawContext = {
        eventName: 'push',
        runId: 800,
        workflow: 'Main Build',
        job: 'build',
        sha: 'commit_xyz',
        ref: 'refs/heads/main',
        repo: { owner: 'acme', repo: 'app' },
        payload: {},
      };

      const eventContext = extractEventContext(rawContext);
      expect(eventContext.eventName).toBe('push');
      expect(eventContext.runId).toBe(800);
      expect(eventContext.pullNumber).toBeUndefined();
    });
  });

  describe('4. Failed Job Selection Logic', () => {
    it('prioritizes explicitly preferred job if it failed', async () => {
      const client = new OctokitClient('mock_token');
      // Mock the internal octokit call
      (client as unknown as { octokit: unknown }).octokit = {
        rest: {
          actions: {
            listJobsForWorkflowRun: async () => ({
              data: {
                jobs: [
                  {
                    id: 1,
                    name: 'lint',
                    conclusion: 'failure',
                    started_at: '2026-08-14T01:00:00Z',
                    steps: [{ name: 'Run linter', conclusion: 'failure' }],
                  },
                  {
                    id: 2,
                    name: 'test-unit',
                    conclusion: 'failure',
                    started_at: '2026-08-14T01:05:00Z',
                    steps: [{ name: 'Run unit tests', conclusion: 'failure' }],
                  },
                ],
              },
            }),
          },
        },
      };

      const selected = await client.getFailedJob('owner', 'repo', 100, 'test-unit');
      expect(selected?.jobId).toBe(2);
      expect(selected?.jobName).toBe('test-unit');
      expect(selected?.stepName).toBe('Run unit tests');
    });

    it('distinguishes failure, timed_out, and cancelled jobs deterministically', async () => {
      const client = new OctokitClient('mock_token');
      (client as unknown as { octokit: unknown }).octokit = {
        rest: {
          actions: {
            listJobsForWorkflowRun: async () => ({
              data: {
                jobs: [
                  {
                    id: 10,
                    name: 'compile',
                    conclusion: 'success',
                    steps: [{ name: 'build', conclusion: 'success' }],
                  },
                  {
                    id: 20,
                    name: 'integration-tests',
                    conclusion: 'timed_out',
                    started_at: '2026-08-14T02:00:00Z',
                    steps: [{ name: 'run integration tests', conclusion: 'timed_out' }],
                  },
                  {
                    id: 30,
                    name: 'e2e-tests',
                    conclusion: 'cancelled',
                    started_at: '2026-08-14T02:10:00Z',
                    steps: [{ name: 'run cypress', conclusion: 'cancelled' }],
                  },
                ],
              },
            }),
          },
        },
      };

      // Since there is no 'failure' job, it should deterministically select the 'timed_out' job over 'cancelled'
      const selected = await client.getFailedJob('owner', 'repo', 200);
      expect(selected?.jobId).toBe(20);
      expect(selected?.jobName).toBe('integration-tests');
      expect(selected?.stepName).toBe('run integration tests');
      expect(selected?.conclusion).toBe('timed_out');
    });
  });

  describe('5. Historical Runs & Fingerprint Extraction', () => {
    it('retrieves same-workflow historical runs, excludes current run, and derives fingerprints', async () => {
      const client = new OctokitClient('mock_token');
      (client as unknown as { octokit: unknown }).octokit = {
        rest: {
          actions: {
            listWorkflowRuns: async () => ({
              data: {
                workflow_runs: [
                  {
                    id: 100, // current run, should be excluded
                    workflow_id: 42,
                    head_sha: 'sha_curr',
                    conclusion: 'failure',
                    created_at: '2026-08-14T03:00:00Z',
                  },
                  {
                    id: 99, // past failed run
                    workflow_id: 42,
                    head_sha: 'sha_past_fail',
                    conclusion: 'failure',
                    created_at: '2026-08-13T03:00:00Z',
                  },
                  {
                    id: 98, // past success run
                    workflow_id: 42,
                    head_sha: 'sha_past_ok',
                    conclusion: 'success',
                    created_at: '2026-08-12T03:00:00Z',
                  },
                ],
              },
            }),
            listJobsForWorkflowRun: async () => ({
              data: {
                jobs: [
                  {
                    id: 991,
                    name: 'test',
                    conclusion: 'failure',
                    steps: [{ name: 'Run tests', conclusion: 'failure' }],
                  },
                ],
              },
            }),
          },
        },
      };

      // Mock getJobLogStream to return failure log for historical failed run
      client.getJobLogStream = async () =>
        createStringLogProvider(
          'FAIL src/auth/login.test.ts\n  ✕ expected false to be true\n  AssertionError: expected false to be true',
        );

      const history = await client.getHistoricalRuns('owner', 'repo', '42', 100, 5);
      expect(history).toHaveLength(2);
      expect(history.find((r) => r.runId === 100)).toBeUndefined(); // Current run excluded

      const failedHistRun = history.find((r) => r.runId === 99);
      expect(failedHistRun).toBeDefined();
      expect(failedHistRun?.conclusion).toBe('failure');
      expect(failedHistRun?.fingerprints.length).toBeGreaterThan(0);

      const successHistRun = history.find((r) => r.runId === 98);
      expect(successHistRun?.conclusion).toBe('success');
      expect(successHistRun?.fingerprints).toEqual([]);
    });
  });

  describe('6. Context Builder & Graceful Degradation', () => {
    it('builds platform-agnostic AnalysisContext with warnings on degraded optional APIs', async () => {
      const client = new MockGitHubClient();
      client.shouldFailChangedFiles = true;
      client.shouldFailHistoricalRuns = true;

      const warnings: string[] = [];
      const eventContext = extractEventContext({
        eventName: 'pull_request',
        runId: 200,
        workflow: 'Build Workflow',
        job: 'build-and-test',
        repo: { owner: 'acme', repo: 'app' },
        payload: { pull_request: { number: 10 } },
      });

      const inputs = parseActionInputs((name) => (name === 'github-token' ? 'token123' : ''));
      const analysisContext = await buildAnalysisContext(eventContext, inputs.config, client, {
        warningLogger: (msg) => warnings.push(msg),
      });

      expect(analysisContext.workflowName).toBe('Build Workflow');
      expect(analysisContext.runId).toBe(200);
      expect(analysisContext.changedFiles).toEqual([]);
      expect(analysisContext.historicalRuns).toEqual([]);
      expect(warnings.some((w) => w.includes('CODE_REGRESSION evidence degraded'))).toBe(true);
      expect(warnings.some((w) => w.includes('FLAKY_TEST evidence degraded'))).toBe(true);
    });
  });

  describe('7. Action Orchestrator, Step Summary, PR Commenting & Safety', () => {
    it('runs full end-to-end orchestration, writes summary, sets outputs, posts PR comment', async () => {
      const client = new MockGitHubClient();
      client.logContent = FIXTURES.econnrefused;

      let writtenSummary = '';
      const outputs: Record<string, string> = {};
      let loggedInfo = '';

      const inputGetter = (name: string) => {
        if (name === 'github-token') return 'secret_token_abc';
        if (name === 'comment-on-pr') return 'true';
        return '';
      };

      const githubContext = {
        eventName: 'pull_request',
        runId: 300,
        workflow: 'Test Pipeline',
        job: 'unit-tests',
        repo: { owner: 'my-org', repo: 'my-repo' },
        payload: { pull_request: { number: 7 } },
      };

      await runActionOrchestrator({
        inputGetter,
        githubContext,
        client,
        summaryWriter: async (content) => {
          writtenSummary = content;
        },
        outputSetter: (name, val) => {
          outputs[name] = val;
        },
        infoLogger: (msg) => {
          loggedInfo += msg + '\n';
        },
      });

      // Step Summary written
      expect(writtenSummary).toContain('# CI Triage');
      expect(writtenSummary).toContain('NETWORK');
      expect(writtenSummary).toContain('ECONNREFUSED');

      // Outputs set
      expect(outputs.classification).toBe('NETWORK');
      expect(Number(outputs.confidence)).toBeGreaterThan(0);
      expect(outputs.summary).toBe(writtenSummary);

      // PR Comment posted
      expect(client.postPRCommentCalls).toHaveLength(1);
      expect(client.postPRCommentCalls[0].pullNumber).toBe(7);
      expect(client.postPRCommentCalls[0].body).toContain('NETWORK');
      expect(loggedInfo).toContain('CI Triage completed: NETWORK');
    });

    it('disables PR commenting when comment-on-pr is false', async () => {
      const client = new MockGitHubClient();
      const inputGetter = (name: string) => {
        if (name === 'github-token') return 'secret_token';
        if (name === 'comment-on-pr') return 'false';
        return '';
      };

      await runActionOrchestrator({
        inputGetter,
        githubContext: {
          eventName: 'pull_request',
          runId: 300,
          workflow: 'CI',
          repo: { owner: 'o', repo: 'r' },
          payload: { pull_request: { number: 7 } },
        },
        client,
        summaryWriter: async () => {},
        outputSetter: () => {},
      });

      expect(client.postPRCommentCalls).toHaveLength(0);
    });

    it('handles non-PR execution gracefully when comment-on-pr is true', async () => {
      const client = new MockGitHubClient();
      let loggedInfo = '';

      const inputGetter = (name: string) => {
        if (name === 'github-token') return 'secret_token';
        if (name === 'comment-on-pr') return 'true';
        return '';
      };

      await runActionOrchestrator({
        inputGetter,
        githubContext: {
          eventName: 'push',
          runId: 400,
          workflow: 'Deploy Workflow',
          repo: { owner: 'o', repo: 'r' },
          payload: {},
        },
        client,
        summaryWriter: async () => {},
        outputSetter: () => {},
        infoLogger: (msg) => {
          loggedInfo += msg + '\n';
        },
      });

      expect(client.postPRCommentCalls).toHaveLength(0);
      expect(loggedInfo).toContain('no associated pull request was found');
    });

    it('sanitizes secrets and handles PR comment API failures without failing diagnosis', async () => {
      const client = new MockGitHubClient();
      client.shouldFailPRComment = true;
      let warnedMessage = '';
      let maskedSecret = '';

      const sensitiveToken = 'super_secret_github_token_xyz';
      const inputGetter = (name: string) => {
        if (name === 'github-token') return sensitiveToken;
        if (name === 'comment-on-pr') return 'true';
        return '';
      };

      await runActionOrchestrator({
        inputGetter,
        githubContext: {
          eventName: 'pull_request',
          runId: 500,
          workflow: 'CI',
          repo: { owner: 'o', repo: 'r' },
          payload: { pull_request: { number: 12 } },
        },
        client,
        summaryWriter: async () => {},
        outputSetter: () => {},
        warningLogger: (msg) => {
          warnedMessage = msg;
        },
        secretMasker: (sec) => {
          maskedSecret = sec;
        },
      });

      expect(maskedSecret).toBe(sensitiveToken);
      expect(warnedMessage).toContain('Failed to post comment to PR #12');
      expect(warnedMessage).not.toContain(sensitiveToken);
    });
  });
});
