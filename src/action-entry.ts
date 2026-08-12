import * as core from '@actions/core';

async function run(): Promise<void> {
  try {
    core.info('CI Triage Action v0.1.0 Initializing...');

    const githubToken = core.getInput('github-token', { required: true });
    const historyDepth = parseInt(core.getInput('history-depth') || '10', 10);
    const commentOnPR = core.getInput('comment-on-pr') === 'true';

    core.info(`Configured history depth: ${historyDepth}`);
    core.info(`PR commenting enabled: ${commentOnPR}`);

    if (!githubToken) {
      throw new Error('github-token input is missing or empty');
    }

    // Phase 1 initialization placeholder
    core.setOutput('classification', 'UNKNOWN');
    core.setOutput('confidence', '0');
    core.setOutput('summary', 'CI Triage initialized successfully.');
    core.info('CI Triage Phase 1 Action Entrypoint Executed.');
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(`CI Triage Action failed: ${error.message}`);
    } else {
      core.setFailed('CI Triage Action encountered an unexpected error.');
    }
  }
}

void run();
