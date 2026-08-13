# CI Triage

> Understand why CI failed without digging through thousands of log lines.

CI Triage is an open-source GitHub Actions failure-triage tool. It automatically analyzes failed GitHub Actions workflows and produces concise, evidence-backed diagnoses for developers.

## Core Features

- **Evidence-First Analysis**: Gathers objective signals before generating explanations. Defaults conservatively to `UNKNOWN` when evidence is insufficient.
- **Deterministic Detectors**: Identifies test failures, flaky tests, dependency conflicts, network timeouts, build crashes, permission errors, resource depletion, and workflow configuration issues.
- **Cross-Run Fingerprint Comparison**: Tracks canonical error signatures across historical runs to distinguish intermittent flaky behavior from true regressions.
- **Automatic Secret Scrubbing**: Redacts tokens, keys, and credentials from log snippets prior to reporting.
- **Zero-Config GitHub Step Summaries**: Writes diagnostic reports directly to `$GITHUB_STEP_SUMMARY`.

## Quick Start

Add CI Triage as a workflow step when job execution fails:

```yaml
steps:
  - name: Run CI Triage on Failure
    if: failure()
    uses: ci-triage/ci-triage@v0.1
    with:
      github-token: ${{ secrets.GITHUB_TOKEN }}
      history-depth: 10
```

## Configuration Inputs

| Input | Description | Default |
| --- | --- | --- |
| `github-token` | GitHub access token for workflow log retrieval | `${{ github.token }}` |
| `history-depth` | Number of past workflow runs to compare fingerprints against | `10` |
| `comment-on-pr` | Post triage Markdown summary to Pull Request | `false` |
| `unknown-threshold` | Minimum confidence % required for classification | `50` |
| `min-flaky-confidence` | Minimum confidence % required for FLAKY_TEST | `75` |
| `min-regression-confidence` | Minimum confidence % required for CODE_REGRESSION | `80` |

## Architecture

CI Triage is built with a platform-agnostic core analyzer separated from GitHub integration layers:

```
GitHub Adapter → AnalysisContext → Stream Parser → Detectors → Evidence Engine → Classifier → Reporter
```

## License

[MIT](LICENSE)
