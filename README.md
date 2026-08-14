# CI Triage

> Understand why CI failed without digging through thousands of log lines.

CI Triage is an evidence-backed, deterministic failure diagnosis tool for GitHub Actions. It automatically analyzes workflow failures, extracts canonical error signatures, compares historical run patterns, and produces concise, actionable Markdown diagnoses without transmitting your build logs to external services or LLMs.

---

## Features

- **Deterministic Failure Classification**: Accurately categorizes errors into `TEST_FAILURE`, `FLAKY_TEST`, `CODE_REGRESSION`, `DEPENDENCY`, `NETWORK`, `TIMEOUT`, `CONFIGURATION`, `PERMISSION`, `BUILD`, `RESOURCE`, or defaults safely to `UNKNOWN`.
- **Bounded-Memory Stream Processing**: Streams job logs incrementally through a sliding window parser to guarantee zero memory blowouts even on 100MB+ logs.
- **Cross-Run Historical Fingerprints**: Tracks normalized SHA-256 error fingerprints across previous runs of the same workflow to reliably detect intermittent and flaky tests.
- **Automatic Secret Scrubbing**: Redacts tokens, passwords, private keys, authorization headers, and custom secrets before emitting summaries.
- **Native Step Summaries & Optional PR Comments**: Writes directly to `$GITHUB_STEP_SUMMARY` and optionally posts diagnostic comments to the associated Pull Request.

---

## Minimal Workflow Example

Add CI Triage as a workflow step triggered when prior steps fail:

```yaml
name: Test Suite
on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  actions: read # Required to download workflow job logs

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install dependencies
        run: npm ci

      - name: Run test suite
        run: npm test

      - name: Triage Failures
        if: failure()
        uses: ci-triage/ci-triage@v0.1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          history-depth: 10
```

---

## Optional: Commenting on Pull Requests

To post Markdown triage reports directly as PR comments, enable `comment-on-pr` and grant the `pull-requests: write` permission:

```yaml
permissions:
  contents: read
  actions: read
  pull-requests: write # Required for PR commenting

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      # ... [previous steps] ...

      - name: Triage Failures & Comment on PR
        if: failure()
        uses: ci-triage/ci-triage@v0.1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          comment-on-pr: true
```

---

## Action Inputs

| Input | Description | Default |
| --- | --- | --- |
| `github-token` | GitHub token with read access to workflow runs/logs (and write access to PRs if `comment-on-pr` is enabled). | `${{ github.token }}` |
| `history-depth` | Number of historical workflow runs to inspect for cross-run failure fingerprint comparison. | `10` |
| `comment-on-pr` | Explicitly enable posting a Markdown triage comment to the associated Pull Request. | `false` |
| `unknown-threshold` | Minimum confidence score percentage required (0–100). If maximum score is below this boundary, classification defaults to `UNKNOWN`. | `50` |
| `min-flaky-confidence` | Minimum composite confidence score percentage required for `FLAKY_TEST` classification. | `75` |
| `min-regression-confidence` | Minimum composite confidence score percentage required for `CODE_REGRESSION` classification. | `80` |

---

## Action Outputs

| Output | Description |
| --- | --- |
| `classification` | The primary classified failure category (e.g. `TEST_FAILURE`, `FLAKY_TEST`, `DEPENDENCY`, `UNKNOWN`). |
| `confidence` | Confidence percentage (0–100) associated with the primary diagnosis. |
| `summary` | Concise Markdown diagnostic report containing observed evidence and recommendations. |

---

## Evidence & Diagnostic Notes

- **Deterministic Analysis**: Diagnosis is strictly calculated through weighted deterministic heuristics and syntactic error signature matching. No external AI APIs are called.
- **CODE_REGRESSION**: Requires access to changed files via the GitHub Pull Request API and correlational diff evidence. On non-PR push events, `CODE_REGRESSION` is gracefully omitted in favor of direct category detection.
- **FLAKY_TEST**: Requires historical failure fingerprints observed in previous runs across differing commits on the same workflow. If historical runs cannot be retrieved, analysis continues safely in degraded mode.

---

## License

[MIT](LICENSE)
