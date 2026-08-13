import { describe, it, expect } from 'vitest';
import {
  AnalysisContext,
  AnalysisConfig,
  triageFailure,
  triageAllFailures,
  TestFailureDetector,
  NetworkDetector,
  DependencyDetector,
  TimeoutDetector,
  PermissionDetector,
  ResourceDetector,
  BuildDetector,
  ConfigurationDetector,
  CodeRegressionDetector,
  FlakyTestDetector,
} from '../../src/index.js';
import { createStringLogProvider } from '../../src/core/log-provider.js';
import { parseLogStream } from '../../src/parser/stream-parser.js';
import { FIXTURES } from '../fixtures/index.js';

const mockConfig: AnalysisConfig = {
  historyDepth: 10,
  unknownThreshold: 50,
  minFlakyConfidence: 75,
  minRegressionConfidence: 50,
  maxLogSizeBytes: 10 * 1024 * 1024,
  commentOnPR: false,
  customSecretPatterns: [],
};

function createMockContext(
  changedFiles: string[] = [],
  historicalRuns: AnalysisContext['historicalRuns'] = [],
): AnalysisContext {
  return {
    workflowName: 'CI Workflow',
    runId: 1001,
    jobName: 'build_and_test',
    stepName: 'Run Tests',
    logProvider: createStringLogProvider(''),
    changedFiles,
    historicalRuns,
    environment: { runnerOs: 'ubuntu-latest', nodeVersion: '20.x' },
    config: mockConfig,
  };
}

describe('Phase 3 Deterministic Failure Detectors', () => {
  describe('Fixture-Based Synthetic Log Tests', () => {
    it('1. Jest assertion failure fixture -> TEST_FAILURE', async () => {
      const parseResult = await parseLogStream(
        createStringLogProvider(FIXTURES.jestAssertionFailure),
      );
      const res = triageFailure({ context: createMockContext(), parseResult });
      expect(res.category).toBe('TEST_FAILURE');
      expect(res.confidenceScore).toBeGreaterThanOrEqual(85);
    });

    it('2. Vitest failure fixture -> TEST_FAILURE', async () => {
      const parseResult = await parseLogStream(createStringLogProvider(FIXTURES.vitestFailure));
      const res = triageFailure({ context: createMockContext(), parseResult });
      expect(res.category).toBe('TEST_FAILURE');
    });

    it('3. Pytest failure fixture -> TEST_FAILURE', async () => {
      const parseResult = await parseLogStream(createStringLogProvider(FIXTURES.pytestFailure));
      const res = triageFailure({ context: createMockContext(), parseResult });
      expect(res.category).toBe('TEST_FAILURE');
    });

    it('4. Go test failure fixture -> TEST_FAILURE', async () => {
      const parseResult = await parseLogStream(createStringLogProvider(FIXTURES.goTestFailure));
      const res = triageFailure({ context: createMockContext(), parseResult });
      expect(res.category).toBe('TEST_FAILURE');
    });

    it('5. ECONNREFUSED fixture -> NETWORK', async () => {
      const parseResult = await parseLogStream(createStringLogProvider(FIXTURES.econnrefused));
      const res = triageFailure({ context: createMockContext(), parseResult });
      expect(res.category).toBe('NETWORK');
    });

    it('6. ETIMEDOUT fixture -> NETWORK', async () => {
      const parseResult = await parseLogStream(createStringLogProvider(FIXTURES.etimedout));
      const res = triageFailure({ context: createMockContext(), parseResult });
      expect(res.category).toBe('NETWORK');
    });

    it('7. DNS failure fixture -> NETWORK', async () => {
      const parseResult = await parseLogStream(createStringLogProvider(FIXTURES.dnsFailure));
      const res = triageFailure({ context: createMockContext(), parseResult });
      expect(res.category).toBe('NETWORK');
    });

    it('8. HTTP 429 rate limit fixture -> NETWORK', async () => {
      const parseResult = await parseLogStream(createStringLogProvider(FIXTURES.http429RateLimit));
      const res = triageFailure({ context: createMockContext(), parseResult });
      expect(res.category).toBe('NETWORK');
    });

    it('9. npm dependency conflict fixture -> DEPENDENCY', async () => {
      const parseResult = await parseLogStream(
        createStringLogProvider(FIXTURES.npmDependencyConflict),
      );
      const res = triageFailure({ context: createMockContext(), parseResult });
      expect(res.category).toBe('DEPENDENCY');
    });

    it('10. package not found fixture -> DEPENDENCY', async () => {
      const parseResult = await parseLogStream(createStringLogProvider(FIXTURES.packageNotFound));
      const res = triageFailure({ context: createMockContext(), parseResult });
      expect(res.category).toBe('DEPENDENCY');
    });

    it('11. pip dependency failure fixture -> DEPENDENCY', async () => {
      const parseResult = await parseLogStream(
        createStringLogProvider(FIXTURES.pipDependencyFailure),
      );
      const res = triageFailure({ context: createMockContext(), parseResult });
      expect(res.category).toBe('DEPENDENCY');
    });

    it('12. workflow execution timeout fixture -> TIMEOUT', async () => {
      const parseResult = await parseLogStream(createStringLogProvider(FIXTURES.workflowTimeout));
      const res = triageFailure({ context: createMockContext(), parseResult });
      expect(res.category).toBe('TIMEOUT');
    });

    it('13. EACCES permission fixture -> PERMISSION', async () => {
      const parseResult = await parseLogStream(createStringLogProvider(FIXTURES.eaccesPermission));
      const res = triageFailure({ context: createMockContext(), parseResult });
      expect(res.category).toBe('PERMISSION');
    });

    it('14. HTTP 403 permission fixture -> PERMISSION', async () => {
      const parseResult = await parseLogStream(createStringLogProvider(FIXTURES.http403Permission));
      const res = triageFailure({ context: createMockContext(), parseResult });
      expect(res.category).toBe('PERMISSION');
    });

    it('15. Out-of-memory fixture -> RESOURCE', async () => {
      const parseResult = await parseLogStream(createStringLogProvider(FIXTURES.oomResource));
      const res = triageFailure({ context: createMockContext(), parseResult });
      expect(res.category).toBe('RESOURCE');
    });

    it('16. ENOSPC disk space fixture -> RESOURCE', async () => {
      const parseResult = await parseLogStream(createStringLogProvider(FIXTURES.enospcResource));
      const res = triageFailure({ context: createMockContext(), parseResult });
      expect(res.category).toBe('RESOURCE');
    });

    it('17. TypeScript compilation error fixture -> BUILD', async () => {
      const parseResult = await parseLogStream(
        createStringLogProvider(FIXTURES.tsCompilationError),
      );
      const res = triageFailure({ context: createMockContext(), parseResult });
      expect(res.category).toBe('BUILD');
    });

    it('18. Go compilation error fixture -> BUILD', async () => {
      const parseResult = await parseLogStream(
        createStringLogProvider(FIXTURES.goCompilationError),
      );
      const res = triageFailure({ context: createMockContext(), parseResult });
      expect(res.category).toBe('BUILD');
    });

    it('19. Malformed workflow configuration fixture -> CONFIGURATION', async () => {
      const parseResult = await parseLogStream(
        createStringLogProvider(FIXTURES.malformedConfiguration),
      );
      const res = triageFailure({ context: createMockContext(), parseResult });
      expect(res.category).toBe('CONFIGURATION');
    });

    it('20. Missing environment variable fixture -> CONFIGURATION', async () => {
      const parseResult = await parseLogStream(
        createStringLogProvider(FIXTURES.missingEnvVariable),
      );
      const res = triageFailure({ context: createMockContext(), parseResult });
      expect(res.category).toBe('CONFIGURATION');
    });

    it('21. Code regression fixture -> CODE_REGRESSION', async () => {
      const parseResult = await parseLogStream(createStringLogProvider(FIXTURES.codeRegression));
      const ctx = createMockContext(['src/auth/login.ts']);
      const res = triageFailure({ context: ctx, parseResult });
      expect(res.category).toBe('CODE_REGRESSION');
    });

    it('22. Flaky test fixture -> FLAKY_TEST', async () => {
      const parseResult = await parseLogStream(createStringLogProvider(FIXTURES.flakyTest));
      const fp = parseResult.frames[0].fingerprint;
      const ctx = createMockContext(
        [],
        [
          {
            runId: 50,
            workflowId: 'ci.yml',
            commitSha: 'sha1234',
            conclusion: 'success',
            createdAt: '2026-08-10T12:00:00Z',
            fingerprints: [fp.canonicalHash],
          },
          {
            runId: 49,
            workflowId: 'ci.yml',
            commitSha: 'sha1233',
            conclusion: 'failure',
            createdAt: '2026-08-09T12:00:00Z',
            fingerprints: [fp.canonicalHash],
          },
        ],
      );
      const res = triageFailure({ context: ctx, parseResult });
      expect(res.category).toBe('FLAKY_TEST');
    });
  });

  describe('Negative Cross-Firing Assertions', () => {
    it('TEST_FAILURE must NOT fire on pure network error logs', async () => {
      const parseResult = await parseLogStream(createStringLogProvider(FIXTURES.econnrefused));
      const detector = new TestFailureDetector();
      const res = detector.detect({ context: createMockContext(), parseResult });
      expect(res).toBeNull();
    });

    it('NETWORK must NOT fire on pure test assertion failure logs', async () => {
      const parseResult = await parseLogStream(
        createStringLogProvider(FIXTURES.jestAssertionFailure),
      );
      const detector = new NetworkDetector();
      const res = detector.detect({ context: createMockContext(), parseResult });
      expect(res).toBeNull();
    });

    it('BUILD must NOT fire on pure test failure logs', async () => {
      const parseResult = await parseLogStream(createStringLogProvider(FIXTURES.pytestFailure));
      const detector = new BuildDetector();
      const res = detector.detect({ context: createMockContext(), parseResult });
      expect(res).toBeNull();
    });
  });

  describe('Multi-Signal Evaluation via triageAllFailures', () => {
    it('should return multiple results when evidence supports both DEPENDENCY and NETWORK', async () => {
      const parseResult = await parseLogStream(
        createStringLogProvider(FIXTURES.dependencyNetworkOverlap),
      );
      const results = triageAllFailures({ context: createMockContext(), parseResult });

      expect(results.length).toBeGreaterThanOrEqual(2);
      const categories = results.map((r) => r.category);
      expect(categories).toContain('DEPENDENCY');
      expect(categories).toContain('NETWORK');
    });
  });

  describe('TestFailureDetector', () => {
    it('should detect Jest/Vitest failure signature and summary with high confidence for multiple signals', async () => {
      const log = [
        'FAIL src/components/button.test.tsx',
        '  ● Button Component › should render label',
        '    AssertionError: expected false to be true',
        'Tests: 1 failed, 12 passed, 13 total',
      ].join('\n');

      const provider = createStringLogProvider(log);
      const parseResult = await parseLogStream(provider);
      const detector = new TestFailureDetector();
      const result = detector.detect({ context: createMockContext(), parseResult });

      expect(result).not.toBeNull();
      expect(result?.category).toBe('TEST_FAILURE');
      expect(result?.confidenceScore).toBe(95);
      expect(result?.evidence.length).toBeGreaterThan(0);
      expect(result?.fingerprint?.normalizedErrorLine).toBeDefined();
      expect(result?.suggestedAction).toContain('Inspect the failing test');
    });

    it('should produce lower conservative confidence for weak assertion-only evidence', async () => {
      const log = 'AssertionError: expected 5 to equal 10';
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const detector = new TestFailureDetector();
      const result = detector.detect({ context: createMockContext(), parseResult });

      expect(result).not.toBeNull();
      expect(result?.category).toBe('TEST_FAILURE');
      expect(result?.confidenceScore).toBeLessThanOrEqual(60);
      expect(result?.confidenceScore).toBe(55);
    });

    it('should produce moderate/high confidence for strong test runner header evidence without summary', async () => {
      const log = 'FAIL src/auth/login.test.ts\n  ● login failed';
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const detector = new TestFailureDetector();
      const result = detector.detect({ context: createMockContext(), parseResult });

      expect(result).not.toBeNull();
      expect(result?.category).toBe('TEST_FAILURE');
      expect(result?.confidenceScore).toBe(75);
    });

    it('should NOT create high-confidence TEST_FAILURE on unrelated Expected/Received text alone', async () => {
      const log = 'Error: Log line with Expected: foo, Received: bar in generic context';
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const detector = new TestFailureDetector();
      const result = detector.detect({ context: createMockContext(), parseResult });

      expect(result).not.toBeNull();
      expect(result?.category).toBe('TEST_FAILURE');
      expect(result?.confidenceScore).toBeLessThanOrEqual(60);
    });

    it('should detect Pytest and Go test failures', async () => {
      const pytestLog = 'FAILED tests/test_auth.py::test_login - AssertionError: 401 != 200';
      const parseResult = await parseLogStream(createStringLogProvider(pytestLog));
      const detector = new TestFailureDetector();
      const result = detector.detect({ context: createMockContext(), parseResult });

      expect(result?.category).toBe('TEST_FAILURE');
      expect(result?.evidence[0].snippet).toContain('FAILED tests/test_auth.py::test_login');
    });

    it('should not classify generic error logs without test runner evidence as TEST_FAILURE', async () => {
      const genericLog = 'Error: Unexpected termination of background process';
      const parseResult = await parseLogStream(createStringLogProvider(genericLog));
      const detector = new TestFailureDetector();
      const result = detector.detect({ context: createMockContext(), parseResult });

      expect(result).toBeNull();
    });
  });

  describe('NetworkDetector', () => {
    it('transport failure -> high confidence NETWORK (95)', async () => {
      const log = '2026-08-12T10:00:00Z Error: connect ECONNREFUSED 127.0.0.1:5432';
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const detector = new NetworkDetector();
      const result = detector.detect({ context: createMockContext(), parseResult });

      expect(result?.category).toBe('NETWORK');
      expect(result?.confidenceScore).toBe(95);
      expect(result?.evidence[0].description).toContain('ECONNREFUSED');
    });

    it('generic HTTP 500 -> moderate/ambiguous, not high-confidence NETWORK (60)', async () => {
      const log = 'Error: Service returned HTTP status code 500 Internal Server Error';
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const detector = new NetworkDetector();
      const result = detector.detect({ context: createMockContext(), parseResult });

      expect(result?.category).toBe('NETWORK');
      expect(result?.confidenceScore).toBe(60);
    });

    it('test asserting HTTP 500 -> should not become high-confidence NETWORK (returns null)', async () => {
      const log = 'AssertionError: expect(res.status).toBe(500)';
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const detector = new NetworkDetector();
      const result = detector.detect({ context: createMockContext(), parseResult });

      expect(result).toBeNull();
    });

    it('HTTP 429 without transport failure -> conservative result (60)', async () => {
      const log = 'HTTP 429 Too Many Requests: Rate limit exceeded for endpoint /v1/telemetry';
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const detector = new NetworkDetector();
      const result = detector.detect({ context: createMockContext(), parseResult });

      expect(result?.category).toBe('NETWORK');
      expect(result?.confidenceScore).toBe(60);
    });
  });

  describe('DependencyDetector', () => {
    it('should detect package resolution and ERESOLVE errors', async () => {
      const log =
        'npm ERR! code ERESOLVE\nError: npm ERR! ERESOLVE unable to resolve dependency tree';
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const detector = new DependencyDetector();
      const result = detector.detect({ context: createMockContext(), parseResult });

      expect(result?.category).toBe('DEPENDENCY');
      expect(result?.evidence[0].description).toContain('package resolution');
      expect(result?.confidenceScore).toBeGreaterThanOrEqual(95);
    });

    it('should detect missing package 404 and lockfile out-of-sync errors', async () => {
      const log =
        'Error: npm ERR! 404 Not Found - GET https://registry.npmjs.org/nonexistent-package-xyz';
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const detector = new DependencyDetector();
      const result = detector.detect({ context: createMockContext(), parseResult });

      expect(result?.category).toBe('DEPENDENCY');
      expect(result?.confidenceScore).toBe(95);
    });

    it('repeated overlapping regex matches on single frame do not artificially inflate confidence to 100', async () => {
      const log = [
        'npm ERR! code ERESOLVE',
        'npm ERR! code ERESOLVE',
        'npm ERR! code ERESOLVE',
      ].join('\n');

      const parseResult = await parseLogStream(createStringLogProvider(log));
      const detector = new DependencyDetector();
      const result = detector.detect({ context: createMockContext(), parseResult });

      expect(result?.category).toBe('DEPENDENCY');
      // Confidence equals max base weight (95) and NOT 80 + 3*5 = 95 or higher
      expect(result?.confidenceScore).toBe(95);
    });

    it('unsupported engine failure yields moderate confidence (75)', async () => {
      const log = 'npm ERR! Unsupported engine: Requires node >= 20.0.0';
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const detector = new DependencyDetector();
      const result = detector.detect({ context: createMockContext(), parseResult });

      expect(result?.category).toBe('DEPENDENCY');
      expect(result?.confidenceScore).toBe(75);
    });

    it('generic HTTP failures without package registry context are NOT classified as DEPENDENCY', async () => {
      const log =
        'FetchError: request to https://api.internal.service/v1/data failed, reason: HTTP status 503 Service Unavailable';
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const detector = new DependencyDetector();
      const result = detector.detect({ context: createMockContext(), parseResult });

      expect(result).toBeNull();
    });
  });

  describe('TimeoutDetector', () => {
    it('should detect workflow and command execution timeouts', async () => {
      const log = 'Error: The job has exceeded the maximum execution time of 60 minutes.';
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const detector = new TimeoutDetector();
      const result = detector.detect({ context: createMockContext(), parseResult });

      expect(result?.category).toBe('TIMEOUT');
      expect(result?.confidenceScore).toBe(95);
    });
  });

  describe('PermissionDetector', () => {
    it('should detect permission denied and invalid token scope errors', async () => {
      const log = 'Error: Resource not accessible by integration (403 Forbidden)';
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const detector = new PermissionDetector();
      const result = detector.detect({ context: createMockContext(), parseResult });

      expect(result?.category).toBe('PERMISSION');
      expect(result?.evidence[0].description).toContain('permission');
    });
  });

  describe('ResourceDetector', () => {
    it('should detect Out-Of-Memory and disk space exhaustion', async () => {
      const oomLog =
        'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory';
      const parseResult = await parseLogStream(createStringLogProvider(oomLog));
      const detector = new ResourceDetector();
      const result = detector.detect({ context: createMockContext(), parseResult });

      expect(result?.category).toBe('RESOURCE');
      expect(result?.confidenceScore).toBe(95);

      const diskLog = 'Error: ENOSPC: no space left on device, write';
      const diskResult = detector.detect({
        context: createMockContext(),
        parseResult: await parseLogStream(createStringLogProvider(diskLog)),
      });
      expect(diskResult?.category).toBe('RESOURCE');
    });
  });

  describe('BuildDetector', () => {
    it('explicit compiler error -> high confidence BUILD (95)', async () => {
      const log =
        'Error: src/index.ts(15,8): error TS2307: Cannot find module "./missing" or its corresponding type declarations.';
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const detector = new BuildDetector();
      const result = detector.detect({ context: createMockContext(), parseResult });

      expect(result?.category).toBe('BUILD');
      expect(result?.confidenceScore).toBe(95);
    });

    it('bundler error -> high confidence BUILD (90)', async () => {
      const log = 'Error: [vite] Build failed with errors in src/main.ts';
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const detector = new BuildDetector();
      const result = detector.detect({ context: createMockContext(), parseResult });

      expect(result?.category).toBe('BUILD');
      expect(result?.confidenceScore).toBe(90);
    });

    it('test-time SyntaxError without build context -> moderate/non-high confidence (60)', async () => {
      const log = "SyntaxError: Unexpected token ';' in test execution frame";
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const detector = new BuildDetector();
      const result = detector.detect({ context: createMockContext(), parseResult });

      expect(result?.category).toBe('BUILD');
      expect(result?.confidenceScore).toBe(60);
    });
  });

  describe('ConfigurationDetector', () => {
    it('invalid YAML -> high confidence (95)', async () => {
      const log =
        'Error: Failed to parse workflow YAML file: yaml: line 12: mapping values are not allowed';
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const detector = new ConfigurationDetector();
      const result = detector.detect({ context: createMockContext(), parseResult });

      expect(result?.category).toBe('CONFIGURATION');
      expect(result?.confidenceScore).toBe(95);
    });

    it('missing required secret/env -> high confidence (90)', async () => {
      const log = 'Error: Environment variable DATABASE_URL is required but not set';
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const detector = new ConfigurationDetector();
      const result = detector.detect({ context: createMockContext(), parseResult });

      expect(result?.category).toBe('CONFIGURATION');
      expect(result?.confidenceScore).toBe(90);
    });

    it('invalid action input -> high confidence (90)', async () => {
      const log = 'Error: Invalid action input: parameter "target" is required';
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const detector = new ConfigurationDetector();
      const result = detector.detect({ context: createMockContext(), parseResult });

      expect(result?.category).toBe('CONFIGURATION');
      expect(result?.confidenceScore).toBe(90);
    });

    it('generic package.json/config-file missing -> moderate confidence (60)', async () => {
      const log = 'Error: package.json not found in working directory';
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const detector = new ConfigurationDetector();
      const result = detector.detect({ context: createMockContext(), parseResult });

      expect(result?.category).toBe('CONFIGURATION');
      expect(result?.confidenceScore).toBe(60);
    });
  });

  describe('CodeRegressionDetector', () => {
    it('should correlate failure in stack trace with changed files in pull request', async () => {
      const log = [
        'Error: Validation failed in user auth handler',
        '  at validateUser (src/auth/login.ts:45:12)',
        '  at Object.<anonymous> (src/controllers/user.ts:12:5)',
      ].join('\n');

      const parseResult = await parseLogStream(createStringLogProvider(log));
      const context = createMockContext(['src/auth/login.ts']);
      const detector = new CodeRegressionDetector();
      const result = detector.detect({ context, parseResult });

      expect(result).not.toBeNull();
      expect(result?.category).toBe('CODE_REGRESSION');
      expect(result?.confidenceScore).toBeGreaterThanOrEqual(80);
      expect(result?.evidence[0].description).toContain('src/auth/login.ts');
    });

    it('should return null if stack trace files do not overlap with changedFiles', async () => {
      const log = 'Error: Failure at (src/utils/logger.ts:10:5)';
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const context = createMockContext(['src/components/header.tsx']);
      const detector = new CodeRegressionDetector();
      const result = detector.detect({ context, parseResult });

      expect(result).toBeNull();
    });

    it('changed-file mention alone without stack-trace or source match yields moderate confidence (< 75)', async () => {
      const log = 'Error: Log message mentioning file config.json in passing during build step';
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const context = createMockContext(['config.json']);
      const detector = new CodeRegressionDetector();
      const result = detector.detect({ context, parseResult });

      expect(result).not.toBeNull();
      expect(result?.category).toBe('CODE_REGRESSION');
      expect(result?.confidenceScore).toBeLessThan(75);
    });

    it('ambiguous path collisions like a/b/index.ts vs x/y/index.ts do NOT match', async () => {
      const log = 'Error: Failure in a/b/index.ts:10:5';
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const context = createMockContext(['x/y/index.ts']);
      const detector = new CodeRegressionDetector();
      const result = detector.detect({ context, parseResult });

      expect(result).toBeNull();
    });

    it('handles Windows slashes, monorepo paths, and JS/TS extension cross-matching', async () => {
      const log = 'Error: at validateUser (dist\\auth\\login.js:45:12)';
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const context = createMockContext(['packages/core/src/auth/login.ts']);
      const detector = new CodeRegressionDetector();
      const result = detector.detect({ context, parseResult });

      expect(result).not.toBeNull();
      expect(result?.category).toBe('CODE_REGRESSION');
    });
  });

  describe('FlakyTestDetector', () => {
    it('1. failure + unrelated success -> null', async () => {
      const log = 'Error: Flaky async timing assertion failed';
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const errLine = parseResult.frames[0].rawErrorLine;
      const { generateFingerprint } = await import('../../src/parser/fingerprint.js');
      const fp = generateFingerprint(errLine);

      const historicalRuns: AnalysisContext['historicalRuns'] = [
        {
          runId: 10,
          workflowId: 'ci.yml',
          commitSha: 'shaA',
          conclusion: 'failure',
          createdAt: '2026-08-09T10:00:00Z',
          fingerprints: [fp.canonicalHash],
        },
        {
          runId: 20,
          workflowId: 'deploy.yml',
          commitSha: 'shaB',
          conclusion: 'success',
          createdAt: '2026-08-09T11:00:00Z',
          fingerprints: [fp.canonicalHash],
        },
      ];

      const context = createMockContext([], historicalRuns);
      const detector = new FlakyTestDetector();
      const result = detector.detect({ context, parseResult });

      expect(result).toBeNull();
    });

    it('2. successful run containing matching fingerprint only -> null', async () => {
      const log = 'Error: Flaky async timing assertion failed';
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const errLine = parseResult.frames[0].rawErrorLine;
      const { generateFingerprint } = await import('../../src/parser/fingerprint.js');
      const fp = generateFingerprint(errLine);

      const historicalRuns: AnalysisContext['historicalRuns'] = [
        {
          runId: 100,
          workflowId: 'ci.yml',
          commitSha: 'abc1234',
          conclusion: 'success',
          createdAt: '2026-08-10T12:00:00Z',
          fingerprints: [fp.canonicalHash],
        },
      ];

      const context = createMockContext([], historicalRuns);
      const detector = new FlakyTestDetector();
      const result = detector.detect({ context, parseResult });

      expect(result).toBeNull();
    });

    it('3. insufficient historical relationship information -> null', async () => {
      const log = 'Error: Flaky async timing assertion failed';
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const errLine = parseResult.frames[0].rawErrorLine;
      const { generateFingerprint } = await import('../../src/parser/fingerprint.js');
      const fp = generateFingerprint(errLine);

      // Success occurred BEFORE failure (regression or code break, not flaky pass after fail)
      const historicalRuns: AnalysisContext['historicalRuns'] = [
        {
          runId: 10,
          workflowId: 'ci.yml',
          commitSha: 'shaA',
          conclusion: 'success',
          createdAt: '2026-08-09T10:00:00Z',
          fingerprints: [fp.canonicalHash],
        },
        {
          runId: 20,
          workflowId: 'ci.yml',
          commitSha: 'shaA',
          conclusion: 'failure',
          createdAt: '2026-08-09T12:00:00Z',
          fingerprints: [fp.canonicalHash],
        },
      ];

      const context = createMockContext([], historicalRuns);
      const detector = new FlakyTestDetector();
      const result = detector.detect({ context, parseResult });

      expect(result).toBeNull();
    });

    it('4. confirmed comparable failure->success evidence -> FLAKY_TEST', async () => {
      const log = 'Error: Flaky async timing assertion failed';
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const errLine = parseResult.frames[0].rawErrorLine;
      const { generateFingerprint } = await import('../../src/parser/fingerprint.js');
      const fp = generateFingerprint(errLine);

      const historicalRuns: AnalysisContext['historicalRuns'] = [
        {
          runId: 99,
          workflowId: 'ci.yml',
          commitSha: 'abc1233',
          conclusion: 'failure',
          createdAt: '2026-08-09T12:00:00Z',
          fingerprints: [fp.canonicalHash],
        },
        {
          runId: 100,
          workflowId: 'ci.yml',
          commitSha: 'abc1233',
          conclusion: 'success',
          createdAt: '2026-08-09T12:05:00Z',
          fingerprints: [fp.canonicalHash],
        },
      ];

      const context = createMockContext([], historicalRuns);
      const detector = new FlakyTestDetector();
      const result = detector.detect({ context, parseResult });

      expect(result).not.toBeNull();
      expect(result?.category).toBe('FLAKY_TEST');
      expect(result?.confidenceScore).toBe(75);
      expect(result?.evidence.length).toBeGreaterThanOrEqual(1);
    });

    it('5. multiple confirmed transitions -> higher confidence', async () => {
      const log = 'Error: Flaky async timing assertion failed';
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const errLine = parseResult.frames[0].rawErrorLine;
      const { generateFingerprint } = await import('../../src/parser/fingerprint.js');
      const fp = generateFingerprint(errLine);

      const historicalRuns: AnalysisContext['historicalRuns'] = [
        {
          runId: 98,
          workflowId: 'ci.yml',
          commitSha: 'abc1232',
          conclusion: 'failure',
          createdAt: '2026-08-08T12:00:00Z',
          fingerprints: [fp.canonicalHash],
        },
        {
          runId: 99,
          workflowId: 'ci.yml',
          commitSha: 'abc1232',
          conclusion: 'success',
          createdAt: '2026-08-08T12:10:00Z',
          fingerprints: [fp.canonicalHash],
        },
        {
          runId: 100,
          workflowId: 'ci.yml',
          commitSha: 'abc1235',
          conclusion: 'failure',
          createdAt: '2026-08-11T12:00:00Z',
          fingerprints: [fp.canonicalHash],
        },
        {
          runId: 101,
          workflowId: 'ci.yml',
          commitSha: 'abc1235',
          conclusion: 'success',
          createdAt: '2026-08-11T12:10:00Z',
          fingerprints: [fp.canonicalHash],
        },
      ];

      const context = createMockContext([], historicalRuns);
      const detector = new FlakyTestDetector();
      const result = detector.detect({ context, parseResult });

      expect(result).not.toBeNull();
      expect(result?.category).toBe('FLAKY_TEST');
      expect(result?.confidenceScore).toBeGreaterThanOrEqual(85);
    });

    it('insufficient historical context -> null', async () => {
      const log = 'Error: Brand new unexpected failure';
      const parseResult = await parseLogStream(createStringLogProvider(log));

      const context = createMockContext([], []);
      const detector = new FlakyTestDetector();
      const result = detector.detect({ context, parseResult });

      expect(result).toBeNull();
    });
  });

  describe('UnknownDetector and DetectorRegistry Orchestrator', () => {
    it('should return UNKNOWN fallback when no detector matches', async () => {
      const log = 'Error: Unrecognized system log line with no specific failure pattern';
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const context = createMockContext();

      const result = triageFailure({ context, parseResult });

      expect(result.category).toBe('UNKNOWN');
      expect(result.confidenceScore).toBe(0);
      expect(result.suggestedAction).toContain('Manually inspect');
    });

    it('should evaluate registered detectors and select top confidence category via triageFailure without applying unknownThreshold', async () => {
      const log = 'AssertionError: weak test failure line';

      const parseResult = await parseLogStream(createStringLogProvider(log));
      const context = createMockContext();
      // Set unknownThreshold to 90
      context.config.unknownThreshold = 90;

      const result = triageFailure({ context, parseResult });

      // In Phase 3, registry does NOT override low-confidence candidate with UNKNOWN
      expect(result.category).toBe('TEST_FAILURE');
      expect(result.confidenceScore).toBe(55);
    });

    it('should expose all candidate signals via triageAllFailures', async () => {
      const log = FIXTURES.dependencyNetworkOverlap;
      const parseResult = await parseLogStream(createStringLogProvider(log));
      const context = createMockContext();

      const results = triageAllFailures({ context, parseResult });

      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.some((r) => r.category === 'DEPENDENCY')).toBe(true);
      expect(results.some((r) => r.category === 'NETWORK')).toBe(true);
    });
  });
});
