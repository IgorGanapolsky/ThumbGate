---
phase: 03-governance-into-subway
plan: 03
type: execute
wave: 2
depends_on: [3-01, 3-02]
files_modified:
  - /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/self-heal.js
  - /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/self-healing-check.js
  - /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/self-heal.test.js
  - /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/self-healing-check.test.js
  - /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/package.json
autonomous: true
requirements: [GOV-04, GOV-05]

must_haves:
  truths:
    - "Running self-healing-check.js in Subway produces a health report with budget_status, lint_check, format_check, test_ci checks"
    - "Running self-heal.js when Subway CI is healthy produces healthy:true with no unnecessary fix runs"
    - "DEFAULT_CHECKS in self-healing-check.js does NOT include npm run budget:status, prove:adapters, or prove:automation (ThumbGate-specific)"
    - "self-heal.test.js Jest tests all pass with 0 failures"
    - "self-healing-check.test.js Jest tests all pass with 0 failures"
    - "npm run test:governance runs only governance Jest tests and exits 0"
  artifacts:
    - path: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/self-heal.js"
      provides: "Fix-script executor that runs npm fix scripts after CI failure detection"
      contains: "runSelfHeal"
    - path: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/self-healing-check.js"
      provides: "Health check runner with Subway-adapted DEFAULT_CHECKS"
      contains: "DEFAULT_CHECKS"
    - path: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/self-heal.test.js"
      provides: "Jest test suite for self-heal GOV-04"
      exports: ["healthy system test", "fix plan construction test"]
    - path: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/self-healing-check.test.js"
      provides: "Jest test suite for self-healing-check GOV-04"
      exports: ["DEFAULT_CHECKS test", "health report structure test"]
    - path: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/package.json"
      provides: "test:governance npm script scoping governance tests"
      contains: "test:governance"
  key_links:
    - from: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/self-healing-check.js"
      to: "npm run lint:check, format:check, test:ci in Subway package.json"
      via: "DEFAULT_CHECKS array — command entries reference Subway npm scripts"
      pattern: "lint:check.*format:check.*test:ci"
    - from: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/self-heal.js"
      to: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/self-healing-check.js"
      via: "self-heal.js imports or calls self-healing-check.js to get check results"
      pattern: "require.*self-healing-check"
    - from: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/package.json"
      to: "scripts/__tests__/*.test.js"
      via: "test:governance script: jest scripts/__tests__/ --testPathPattern=governance|budget|contextfs|intent|self-heal"
      pattern: "test:governance"
---

<objective>
Port self-heal.js and self-healing-check.js from ThumbGate into Subway with Subway-adapted DEFAULT_CHECKS, write Jest test suites for both, and add a test:governance npm script to Subway's package.json.

Purpose: GOV-04 requires self-healing CI in Subway. This is Wave 2 because self-healing-check.js references budget-guard.js (from Plan 01) in its DEFAULT_CHECKS for the budget_status check. Plan 01 must complete before this plan runs to ensure that script exists.

Output:
- .claude/scripts/feedback/self-heal.js (Subway copy, path-surgery applied)
- .claude/scripts/feedback/self-healing-check.js (Subway copy, DEFAULT_CHECKS adapted for Subway)
- scripts/__tests__/self-heal.test.js (Jest, GOV-05)
- scripts/__tests__/self-healing-check.test.js (Jest, GOV-05)
- package.json updated with test:governance script
</objective>

<execution_context>
@/Users/ganapolsky_i/.claude/get-shit-done/workflows/execute-plan.md
@/Users/ganapolsky_i/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/03-governance-into-subway/3-RESEARCH.md

Source files to read before porting:
@/Users/ganapolsky_i/workspace/git/igor/ThumbGate/scripts/self-heal.js
@/Users/ganapolsky_i/workspace/git/igor/ThumbGate/scripts/self-healing-check.js
@/Users/ganapolsky_i/workspace/git/igor/ThumbGate/tests/self-heal.test.js
@/Users/ganapolsky_i/workspace/git/igor/ThumbGate/tests/self-healing-check.test.js

Subway package.json (to verify scripts and add test:governance):
@/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/package.json

Prior plans summary references:
@/Users/ganapolsky_i/workspace/git/igor/ThumbGate/.planning/phases/03-governance-into-subway/3-01-SUMMARY.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Port self-heal.js and self-healing-check.js with Subway-adapted DEFAULT_CHECKS</name>
  <files>
    /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/self-heal.js
    /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/self-healing-check.js
  </files>
  <action>
    PART A — Port self-heal.js:

    Read /Users/ganapolsky_i/workspace/git/igor/ThumbGate/scripts/self-heal.js

    Create /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/self-heal.js
    with these changes:

    1. PATH SURGERY:
       Change PROJECT_ROOT from path.join(__dirname, '..') to path.join(__dirname, '..', '..', '..')
       Add comment: // Subway: 3 levels up from .claude/scripts/feedback/

    2. KNOWN_FIX_SCRIPTS in self-heal.js maps npm script names to fix commands. Read the ThumbGate source
       to see the current KNOWN_FIX_SCRIPTS array. Replace ThumbGate-specific entries with Subway entries:

       Subway KNOWN_FIX_SCRIPTS (these npm scripts confirmed in Subway package.json):
       - { name: 'lint_fix', command: ['npm', 'run', 'lint:fix'] }
       - { name: 'format_fix', command: ['npm', 'run', 'format'] }

       Do NOT include:
       - npm run prove:adapters (does not exist in Subway)
       - npm run prove:automation (does not exist in Subway)
       - Any ThumbGate-specific script names

    3. No other logic changes. runSelfHeal(), git diff tracking, and module.exports are verbatim.

    PART B — Port self-healing-check.js:

    Read /Users/ganapolsky_i/workspace/git/igor/ThumbGate/scripts/self-healing-check.js

    Create /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/self-healing-check.js
    with these changes:

    1. PATH SURGERY:
       Change PROJECT_ROOT or any equivalent from path.join(__dirname, '..') to path.join(__dirname, '..', '..', '..')
       Set SUBWAY_ROOT = path.join(__dirname, '..', '..', '..');

    2. CRITICAL — Replace DEFAULT_CHECKS verbatim copy is FORBIDDEN:
       The ThumbGate DEFAULT_CHECKS includes npm run budget:status which does NOT exist in Subway.
       Replace entire DEFAULT_CHECKS with the Subway-adapted version:

       ```javascript
       const SUBWAY_ROOT = path.join(__dirname, '..', '..', '..');
       const DEFAULT_CHECKS = [
         {
           name: 'budget_status',
           command: ['node', path.join(SUBWAY_ROOT, '.claude', 'scripts', 'feedback', 'budget-guard.js'), '--status'],
           timeoutMs: 10_000,
         },
         { name: 'lint_check', command: ['npm', 'run', 'lint:check'], timeoutMs: 5 * 60_000 },
         { name: 'format_check', command: ['npm', 'run', 'format:check'], timeoutMs: 5 * 60_000 },
         { name: 'test_ci', command: ['npm', 'run', 'test:ci'], timeoutMs: 15 * 60_000 },
       ];
       ```

    3. No other logic changes. runChecks(), health report structure, and module.exports are verbatim.

    Verify both scripts load:
      node -e "const sh = require('/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/self-heal'); console.log(typeof sh.runSelfHeal);"
      node -e "const sc = require('/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/self-healing-check'); console.log(typeof sc.runChecks || typeof sc.runSelfHealCheck);"
    Expected: "function" for both

    Verify DEFAULT_CHECKS does NOT include budget:status as an npm script:
      grep "budget:status" /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/self-healing-check.js
    Expected: no match (or match shows it as a node command, not npm run budget:status)

    Verify DEFAULT_CHECKS does NOT include prove:
      grep "prove:" /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/self-healing-check.js
    Expected: no match
  </action>
  <verify>
    node -e "const sh = require('/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/self-heal'); console.log('runSelfHeal:', typeof sh.runSelfHeal);"
    Expected: runSelfHeal: function

    node -e "const sc = require('/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/self-healing-check'); console.log('exports:', Object.keys(sc));"
    Expected: exports: [...] with no error thrown

    grep "prove:" /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/self-healing-check.js
    Expected: no output (ThumbGate-specific scripts removed)

    grep "lint.check\|format.check\|test.ci" /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/self-healing-check.js
    Expected: lines showing Subway DEFAULT_CHECKS entries

    grep "path.join(__dirname.*\.\." /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/self-heal.js
    grep "path.join(__dirname.*\.\." /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/self-healing-check.js
    Expected: both contain path.join(__dirname, '..', '..', '..')
  </verify>
  <done>
    - self-heal.js loads without error; runSelfHeal is a function
    - self-healing-check.js loads without error; check runner function is exported
    - DEFAULT_CHECKS contains budget_status (as node command), lint_check, format_check, test_ci
    - DEFAULT_CHECKS does NOT contain npm run budget:status, prove:adapters, or prove:automation
    - KNOWN_FIX_SCRIPTS in self-heal.js contains lint:fix and format (not ThumbGate scripts)
    - Both files use PROJECT_ROOT = path.join(__dirname, '..', '..', '..')
  </done>
</task>

<task type="auto">
  <name>Task 2: Write Jest test suites for self-heal and self-healing-check, add test:governance npm script</name>
  <files>
    /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/self-heal.test.js
    /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/self-healing-check.test.js
    /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/package.json
  </files>
  <action>
    PART A — Write self-heal.test.js (GOV-05):

    Read /Users/ganapolsky_i/workspace/git/igor/ThumbGate/tests/self-heal.test.js for coverage ideas.
    Read self-heal.js source to understand the actual exported API before writing tests.

    Create /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/self-heal.test.js

    Use Jest syntax with beforeEach/afterEach. self-heal.js uses child_process to run npm scripts
    — do NOT actually run lint:fix or format in tests. Either:
    - Pass custom KNOWN_FIX_SCRIPTS via env var or test injection if the API supports it, OR
    - Use Jest's jest.mock('child_process') to intercept child_process.spawnSync calls

    Read the ThumbGate test to see which approach it uses, then apply the same approach in Jest.

    Required test cases (minimum 3):
    1. "runSelfHeal returns healthy:true when all checks pass (mocked)" — mock child_process so
       all commands exit 0; verify runSelfHeal result has healthy:true or similar positive indicator
    2. "runSelfHeal executes fix plan when a check fails" — mock one check to exit non-zero;
       verify a fix script command is invoked
    3. "KNOWN_FIX_SCRIPTS does not include ThumbGate-specific scripts" — read KNOWN_FIX_SCRIPTS from
       the module and verify it does NOT contain 'prove:adapters', 'prove:automation', 'budget:status'

    PART B — Write self-healing-check.test.js (GOV-05):

    Read /Users/ganapolsky_i/workspace/git/igor/ThumbGate/tests/self-healing-check.test.js for coverage ideas.

    Create /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/self-healing-check.test.js

    Required test cases (minimum 3):
    1. "DEFAULT_CHECKS contains expected Subway-specific check names" — require the module,
       read DEFAULT_CHECKS, verify it includes 'lint_check', 'format_check', 'test_ci', 'budget_status'
    2. "DEFAULT_CHECKS does not contain ThumbGate-specific checks" — verify no entry has command
       containing 'budget:status' as npm arg, 'prove:adapters', or 'prove:automation'
    3. "runChecks (or equivalent) returns a health report object with per-check results" —
       mock child_process so all commands exit 0; call the check runner; verify the result
       has an array or map of check results with pass/fail per check

    PART C — Add test:governance npm script to Subway's package.json:

    Read /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/package.json

    Add to the "scripts" section:
      "test:governance": "jest scripts/__tests__/ --testPathPattern='budget-guard|contextfs|intent-router|self-heal'"

    This allows running all 5 governance test files in isolation without triggering the full RN
    test suite (which takes minutes).

    Do NOT modify any other package.json field.

    Verify the script was added correctly:
      cd /Users/ganapolsky_i/workspace/git/Subway_RN_Demo && node -e "const p = require('./package.json'); console.log(p.scripts['test:governance']);"
    Expected: the jest command string
  </action>
  <verify>
    # Both test files exist and use Jest syntax
    grep -l "beforeEach\|describe\|jest\." /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/self-heal.test.js /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/self-healing-check.test.js
    Expected: both files listed

    # Run all governance tests using the new npm script
    cd /Users/ganapolsky_i/workspace/git/Subway_RN_Demo && npm run test:governance -- --no-coverage 2>&1 | tail -20
    Expected: Tests: N passed, 0 failed (all 5 test files run and pass)

    # Verify ThumbGate baseline not regressed
    cd /Users/ganapolsky_i/workspace/git/igor/ThumbGate && npm test 2>&1 | grep -E "tests|pass|fail" | tail -5
    Expected: 60 node-runner tests, 0 failures

    # Confirm test:governance script in package.json
    cd /Users/ganapolsky_i/workspace/git/Subway_RN_Demo && node -e "console.log(require('./package.json').scripts['test:governance']);"
    Expected: jest ... string (not undefined)
  </verify>
  <done>
    - self-heal.test.js has minimum 3 Jest tests including KNOWN_FIX_SCRIPTS validation
    - self-healing-check.test.js has minimum 3 Jest tests including DEFAULT_CHECKS structure validation
    - npm run test:governance in Subway runs all 5 governance test files and exits 0
    - package.json has test:governance script pointing to jest with testPathPattern
    - ThumbGate npm test still exits 0 with 60 node-runner tests
    - All tests pass: 0 failures across budget-guard, contextfs, intent-router, self-heal, self-healing-check
  </done>
</task>

</tasks>

<verification>
Run all 5 governance test files via the new npm script:
  cd /Users/ganapolsky_i/workspace/git/Subway_RN_Demo && npm run test:governance -- --no-coverage --verbose 2>&1 | tail -30
  Expected: All governance tests pass, 0 failures

Verify DEFAULT_CHECKS safety (no ThumbGate-specific scripts):
  grep -E "prove:|budget:status" /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/self-healing-check.js
  Expected: no output

Verify self-healing-check.js references Subway scripts:
  grep -E "lint.check|format.check|test.ci" /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/self-healing-check.js
  Expected: 3+ matching lines

Verify all 6 governance files exist:
  ls /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/
  Expected: budget-guard.js  contextfs.js  intent-router.js  mcp-policy.js  self-heal.js  self-healing-check.js

ThumbGate regression gate:
  cd /Users/ganapolsky_i/workspace/git/igor/ThumbGate && npm test 2>&1 | tail -5
  Expected: exits 0, 60 node-runner tests passing
</verification>

<success_criteria>
1. self-heal.js in Subway loads without error; KNOWN_FIX_SCRIPTS does not reference ThumbGate scripts
2. self-healing-check.js DEFAULT_CHECKS uses budget-guard.js directly (not npm run budget:status), and includes lint_check, format_check, test_ci
3. self-heal.test.js has minimum 3 Jest tests all passing
4. self-healing-check.test.js has minimum 3 Jest tests all passing
5. npm run test:governance runs all 5 governance test files and exits 0
6. ThumbGate npm test still exits 0 with 60 node-runner tests
</success_criteria>

<output>
After completion, create /Users/ganapolsky_i/workspace/git/igor/ThumbGate/.planning/phases/03-governance-into-subway/3-03-SUMMARY.md
</output>
