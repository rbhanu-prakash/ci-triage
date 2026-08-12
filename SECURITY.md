# Security Policy

## Reporting Security Vulnerabilities

CI Triage handles CI workflow logs and GitHub credentials. We take security seriously.

If you discover a security vulnerability within CI Triage—including secret leakage risks, token mishandling, or credential exposure—please do **not** open a public issue.

Instead, please report it via private email or GitHub Security Advisory.

## Security Guarantees in CI Triage

1. **Secret Scrubbing**: All logs and extracted snippets pass through a multi-pass regex redactor before being formatted into Markdown or posted to step summaries.
2. **Credential Isolation**: CI Triage never stores or transmits GitHub API tokens outside of the executing runner environment.
3. **No External AI Services**: In version 0.1, CI Triage performs 100% deterministic local log analysis without sending logs or code to external LLM endpoints.
