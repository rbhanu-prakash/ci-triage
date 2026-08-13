import * as core from '@actions/core';
import * as github from '@actions/github';
import { parseActionInputs } from './github/inputs.js';
import { extractEventContext } from './github/event-context.js';
import { GitHubClient, OctokitClient } from './github/octokit-client.js';
import { buildAnalysisContext } from './github/context-builder.js';
import { parseLogStream } from './parser/stream-parser.js';
import { triageAllFailures } from './detectors/registry.js';
import { Classifier } from './core/classifier.js';
import { generateMarkdownReport } from './reporter/markdown.js';

export interface ActionOrchestrationDeps {
  inputGetter?: (name: string) => string;
  githubContext?: unknown;
  client?: GitHubClient;
  summaryWriter?: (content: string) => Promise<void>;
  outputSetter?: (name: string, value: string) => void;
  warningLogger?: (message: string) => void;
  infoLogger?: (message: string) => void;
  secretMasker?: (secret: string) => void;
}

export async function runActionOrchestrator(deps: ActionOrchestrationDeps = {}): Promise<void> {
  const inputGetter = deps.inputGetter || ((name: string) => core.getInput(name));
  const githubContext = deps.githubContext || github.context;
  const summaryWriter =
    deps.summaryWriter ||
    (async (content: string) => {
      await core.summary.addRaw(content).write();
    });
  const outputSetter =
    deps.outputSetter || ((name: string, value: string) => core.setOutput(name, value));
  const warningLogger = deps.warningLogger || ((msg: string) => core.warning(msg));
  const infoLogger = deps.infoLogger || ((msg: string) => core.info(msg));
  const secretMasker = deps.secretMasker || ((secret: string) => core.setSecret(secret));

  let token = '';

  try {
    // 1. Read and validate action inputs
    const { githubToken, config } = parseActionInputs(inputGetter);
    token = githubToken;
    if (token) {
      secretMasker(token);
    }

    // 2. Extract EventContext from GitHub Actions context
    const eventContext = extractEventContext(githubContext);

    // 3. Initialize GitHub client
    const client = deps.client || new OctokitClient(token);

    // 4. Build AnalysisContext (fetches failed job metadata, logs, changed files, historical runs)
    const analysisContext = await buildAnalysisContext(eventContext, config, client);

    // 5. Parse logs using Phase 2 parseLogStream
    const parseResult = await parseLogStream(analysisContext.logProvider, analysisContext.config);

    // 6. Run Phase 3 detectors against evidence and context
    const detectorResults = triageAllFailures({
      context: analysisContext,
      parseResult,
    });

    // 7. Run Phase 4 classifier to synthesize final TriageReport
    const classifier = new Classifier();
    const report = classifier.classify(detectorResults, analysisContext);

    // 8. Generate Markdown report
    const reportMarkdown = generateMarkdownReport(report);

    // 9. Write GitHub Step Summary
    await summaryWriter(reportMarkdown);

    // 10. Set Action outputs
    outputSetter('classification', report.classification);
    outputSetter('confidence', report.confidence.toString());
    outputSetter('summary', reportMarkdown);

    infoLogger(`CI Triage completed: ${report.classification} (${report.confidence}% confidence)`);

    // 11. Optionally post comment on Pull Request
    if (config.commentOnPR) {
      if (eventContext.pullNumber && eventContext.owner && eventContext.repo) {
        try {
          await client.postPRComment(
            eventContext.owner,
            eventContext.repo,
            eventContext.pullNumber,
            reportMarkdown,
          );
          infoLogger(
            `Successfully posted triage report comment to PR #${eventContext.pullNumber}.`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const sanitizedMsg = token ? msg.replace(new RegExp(token, 'g'), '***') : msg;
          warningLogger(
            `Failed to post comment to PR #${eventContext.pullNumber}: ${sanitizedMsg}`,
          );
        }
      } else {
        infoLogger(
          'PR commenting is enabled (comment-on-pr: true), but no associated pull request was found for this run.',
        );
      }
    }
  } catch (error) {
    let errorMessage = error instanceof Error ? error.message : String(error);
    if (token) {
      errorMessage = errorMessage.replace(new RegExp(token, 'g'), '***');
    }
    core.setFailed(`CI Triage Action failed: ${errorMessage}`);
  }
}

async function run(): Promise<void> {
  await runActionOrchestrator();
}

void run();
