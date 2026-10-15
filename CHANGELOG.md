# Changelog

All notable changes to CI Triage are documented here.

## 0.1.0 — Initial release candidate (not yet published)

This entry records the current release scope. It does not mean a GitHub Release or version tag has been published yet.

- Deterministic GitHub Actions failure classification with confidence scoring and an `UNKNOWN` fallback.
- Bounded log processing, secret scrubbing, and cross-run failure fingerprints.
- Step-summary reporting and optional pull-request comments.
- Runtime metrics for log bytes processed and analysis duration.
- Automated type-checking, linting, formatting, unit tests, action bundling, and committed-bundle consistency checks.
- End-to-end verification of a synthetic network failure: the triage workflow classified it as `NETWORK` with 95% confidence and passed its expected-result assertion.

### Known validation boundary

The end-to-end evidence above verifies the network-failure scenario only. Other failure categories and real-world repositories need additional testing before making broader accuracy or production-readiness claims.
