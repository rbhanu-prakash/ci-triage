export const FIXTURES = {
  jestAssertionFailure: `FAIL src/components/button.test.tsx
  ● Button Component › should render label
    AssertionError: expected false to be true
      at Object.<anonymous> (src/components/button.test.tsx:24:18)

Test Suites: 1 failed, 12 passed, 13 total
Tests:       1 failed, 45 passed, 46 total`,

  vitestFailure: ` ❯ src/utils/math.test.ts (1)
   × calculateTotal > calculates correct tax amount

  - Expected: 105
  + Received: 100

  ❯ src/utils/math.test.ts:15:12

 Test Files  1 failed | 5 passed (6)
      Tests  1 failed | 20 passed (21)`,

  pytestFailure: `=========================== FAILURES ===========================
__________________________ test_login __________________________
tests/test_auth.py:42: in test_login
    assert response.status_code == 200
E   AssertionError: 401 != 200

=================== short test summary info ====================
FAILED tests/test_auth.py::test_login - AssertionError: 401 != 200
==================== 1 failed in 0.45s ====================`,

  goTestFailure: `--- FAIL: TestProcessData (0.02s)
    process_test.go:35: expected status "ready", got "pending"
FAIL
FAIL    github.com/example/app/pkg/process 0.045s`,

  econnrefused: `2026-08-12T10:00:00.000Z [error] Failed to connect to database service
Error: connect ECONNREFUSED 127.0.0.1:5432
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1187:16)`,

  etimedout: `2026-08-12T10:00:00.000Z [error] Network request timed out after 30000ms
FetchError: request to https://api.internal.service/v1/data failed, reason: connect ETIMEDOUT 10.0.0.15:443`,

  dnsFailure: `2026-08-12T10:00:00.000Z [error] Could not resolve hostname
Error: getaddrinfo ENOTFOUND api.external-domain.invalid
    at GetAddrInfoReqWrap.onlookup [as oncomplete] (node:dns:108:26)`,

  http429RateLimit: `2026-08-12T10:00:00.000Z [error] API rate limit exceeded
HTTP 429 Too Many Requests: Rate limit exceeded for endpoint /v1/telemetry`,

  npmDependencyConflict: `npm ERR! code ERESOLVE
npm ERR! ERESOLVE unable to resolve dependency tree
npm ERR! 
npm ERR! While resolving: my-app@1.0.0
npm ERR! Found: react@18.2.0
npm ERR! node_modules/react
npm ERR!   react@"^18.2.0" from the root project
npm ERR! 
npm ERR! Could not resolve dependency:
npm ERR! peer react@"^17.0.0" from legacy-plugin@2.1.0`,

  packageNotFound: `npm ERR! code E404
npm ERR! 404 Not Found - GET https://registry.npmjs.org/nonexistent-package-xyz-123 - Not found
npm ERR! 404 
npm ERR! 404 'nonexistent-package-xyz-123' is not in the npm registry.`,

  pipDependencyFailure: `ERROR: Could not find a version that satisfies the requirement invalid-pkg-name==99.99.99 (from versions: none)
ERROR: No matching distribution found for invalid-pkg-name==99.99.99`,

  workflowTimeout: `##[error]The job has exceeded the maximum execution time of 60 minutes.
##[error]Process completed with exit code 1.`,

  eaccesPermission: `npm ERR! code EACCES
npm ERR! syscall open
npm ERR! path /usr/local/lib/node_modules/my-global-pkg
npm ERR! errno -13
npm ERR! Error: EACCES: permission denied, open '/usr/local/lib/node_modules/my-global-pkg'`,

  http403Permission: `2026-08-12T10:00:00.000Z [error] Resource not accessible by integration
Error: HTTP 403 Forbidden - Resource not accessible by integration`,

  oomResource: `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
 1: 0xb83d20 node::Abort() [node]
 2: 0xa9c365  [node]`,

  enospcResource: `Error: ENOSPC: no space left on device, write
    at Object.writeSync (node:fs:952:3)
    at writeFileSync (node:fs:2202:26)`,

  tsCompilationError: `src/services/user.ts(18,25): error TS2307: Cannot find module './auth-helper' or its corresponding type declarations.
src/services/user.ts(42,10): error TS2322: Type 'string' is not assignable to type 'number'.`,

  goCompilationError: `# github.com/example/app/cmd/server
./main.go:24:12: undefined: InitializeDatabase
./main.go:30:5: cannot use "production" (type string) as type int in argument to SetEnvironment`,

  malformedConfiguration: `2026-08-12T10:00:00.000Z [error] Failed to parse workflow YAML file
yaml: line 14: did not find expected key while parsing a block mapping in .github/workflows/ci.yml`,

  missingEnvVariable: `Error: Environment variable DATABASE_URL is required but not set
    at validateConfig (src/config.ts:12:11)
    at Object.<anonymous> (src/index.ts:5:1)`,

  codeRegression: `Error: Validation failed in user auth handler
    at validateUser (src/auth/login.ts:45:12)
    at Object.<anonymous> (src/controllers/user.ts:12:5)`,

  flakyTest: `Error: Async timing threshold exceeded in integration suite
    at Timeout._onTimeout (tests/integration/async.test.ts:88:15)`,

  // Multi-signal scenario (DEPENDENCY + NETWORK overlap)
  dependencyNetworkOverlap: `npm ERR! code E404
npm ERR! 404 Not Found - GET https://registry.npmjs.org/nonexistent-pkg - HTTP status 503 Service Unavailable
FetchError: request to https://registry.npmjs.org/nonexistent-pkg failed, reason: 503 Service Unavailable`,
} as const;
