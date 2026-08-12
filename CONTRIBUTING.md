# Contributing to CI Triage

Thank you for your interest in contributing to CI Triage!

## Core Principles

- **Evidence-First, Not AI-First**: Analysis must rely on observable log signatures, cross-run fingerprints, and structural evidence.
- **Conservative Classification**: Prefer `UNKNOWN` over guessing root causes without high-confidence evidence.
- **Platform-Agnostic Engine**: Core parsing, detectors, and classification modules must remain independent from GitHub API dependencies.

## Development Setup

```bash
# Install dependencies
npm ci

# Typecheck
npm run typecheck

# Run test suite
npm run test

# Lint & Format
npm run lint
npm run format

# Build action bundle
npm run build
```

## Adding Failure Detectors

1. Create a log fixture under `tests/fixtures/` capturing the target failure mode.
2. Implement or extend a detector in `src/detectors/`.
3. Add unit tests in `tests/unit/detectors.test.ts`.
