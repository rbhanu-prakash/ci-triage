import { describe, it, expect } from 'vitest';
import { parseActionInputs } from '../../src/github/inputs.js';
import { extractEventContext } from '../../src/github/event-context.js';
import { buildAnalysisContext } from '../../src/github/context-builder.js';
import { FailedJobDetails, GitHubClient } from '../../src/github/octokit-client.js';
import { runActionOrchestrator } from '../../src/action-entry.js';
import { createStringLogProvider } from '../../src/core/log-provider.js';
import { FIXTURES } from '../fixtures/index.js';
import { HistoricalRun, LogStreamProvider } from '../../src/core/types.js';

class MockGitHubClient implements GitHubClient {
  public failedJobResult: FailedJobDetails | null = {
    jobId: 101,
    jobName: 'build-and-test',
    stepName: 'Run tests',
  };
  public logContent: string = FIXTURES.jestAssertionFailure;
  public changedFilesResult = ['src/components/button.tsx'];
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
    return this.changedFilesResult;
  }

  async getHistoricalRuns(
    _owner: string,
    _repo: string,
    _workflowNameOrId: string,
    _currentRunId: number,
    _depth: number,
  ): Promise<HistoricalRun[]> {
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

    it('throws when history-depth is invalid', () => {
      const getter = (name: string) => {
        if (name === 'github-token') return 'ghp_secret';
        if (name === 'history-depth') return 'invalid_number';
        return '';
      };
      expect(() => parseActionInputs(getter)).toThrow(
        'Invalid input "history-depth": expected non-negative integer, got "invalid_number".',
      );
    });

    it('throws when comment-on-pr is not a valid boolean string', () => {
      const getter = (name: string) => {
        if (name === 'github-token') return 'ghp_secret';
        if (name === 'comment-on-pr') return 'maybe';
        return '';
      };
      expect(() => parseActionInputs(getter)).toThrow(
        'Invalid input "comment-on-pr": expected "true" or "false", got "maybe".',
      );
    });

    it('throws when unknown-threshold is out of bounds', () => {
      const getter = (name: string) => {
        if (name === 'github-token') return 'ghp_secret';
        if (name === 'unknown-threshold') return '150';
        return '';
      };
      expect(() => parseActionInputs(getter)).toThrow(
        'Invalid input "unknown-threshold": expected an integer between 0 and 100, got "150".',
      );
    });
  });

  describe('3. GitHub Context Mapping', () => {
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
        runId: 9999, // runner run
        workflow: 'Triage Workflow',
        job: 'triage-job',
        repo: { owner: 'acme', repo: 'app' },
        payload: {
          workflow_run: {
            id: 5005, // target failed run
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
  });

  describe('4, 5, 6, 7, 8. Context Builder & Log Provider', () => {
    it('builds platform-agnostic AnalysisContext using client data', async () => {
      const client = new MockGitHubClient();
      const eventContext = extractEventContext({
        eventName: 'pull_request',
        runId: 200,
        workflow: 'Build Workflow',
        job: 'build-and-test',
        repo: { owner: 'acme', repo: 'app' },
        payload: { pull_request: { number: 10 } },
      });

      const inputs = parseActionInputs((name) => (name === 'github-token' ? 'token123' : ''));
      const analysisContext = await buildAnalysisContext(eventContext, inputs.config, client);

      expect(analysisContext.workflowName).toBe('Build Workflow');
      expect(analysisContext.runId).toBe(200);
      expect(analysisContext.jobName).toBe('build-and-test');
      expect(analysisContext.stepName).toBe('Run tests');
      expect(analysisContext.changedFiles).toEqual(['src/components/button.tsx']);
      expect(analysisContext.historicalRuns).toHaveLength(1);
      expect(analysisContext.environment.runnerOs).toBeDefined();

      let logText = '';
      for await (const line of analysisContext.logProvider.getLineStream()) {
        logText += line + '\n';
      }
      expect(logText).toContain('AssertionError: expected false to be true');
    });
  });

  describe('9-16. Action Orchestrator, Step Summary, PR Commenting & Safety', () => {
    it('16. full end-to-end orchestration using mocked GitHub data', async () => {
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

    it('11. PR comment disabled when comment-on-pr is false', async () => {
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

    it('13. non-PR execution with comment-on-pr true handles gracefully', async () => {
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
          eventName: 'push', // push event, no PR
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

    it('14 & 15. GitHub PR comment API failure handled gracefully with secret non-leakage', async () => {
      const client = new MockGitHubClient();
      client.shouldFailPRComment = true; // force 403 / failure on PR comment
      let warnedMessage = '';

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
      });

      expect(warnedMessage).toContain('Failed to post comment to PR #12');
      expect(warnedMessage).not.toContain(sensitiveToken);
    });
  });
});
