---
phase: 03-governance-into-subway
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/mcp-policy.js
  - /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/intent-router.js
  - /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/mcp-allowlists.json
  - /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/subagent-profiles.json
  - /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/policy-bundles/default-v1.json
  - /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/policy-bundles/constrained-v1.json
  - /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/intent-router.test.js
autonomous: true
requirements: [GOV-02, GOV-05]

must_haves:
  truths:
    - "planIntent() in Subway returns { status: 'checkpoint_required' } when approved=false for a checkpoint-gated intent"
    - "planIntent() in Subway returns { status: 'ready' } when approved=true for the same intent"
    - "getMcpAllowlist() correctly looks up tool allowlist for 'default' profile from mcp-allowlists.json"
    - "intent-router.test.js Jest tests all pass with 0 failures"
    - "Config files exist at .claude/config/ (not at repo root)"
  artifacts:
    - path: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/mcp-policy.js"
      provides: "MCP profile-to-tool allowlist lookup"
      contains: "getMcpAllowlist"
    - path: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/intent-router.js"
      provides: "Risk-stratified intent planning with approval checkpoints"
      contains: "planIntent"
    - path: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/mcp-allowlists.json"
      provides: "Profile-to-tool allowlist (3 profiles: default, readonly, locked)"
      contains: "default"
    - path: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/subagent-profiles.json"
      provides: "Subagent profile mapping (3 profiles)"
      contains: "default"
    - path: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/policy-bundles/default-v1.json"
      provides: "Balanced intent policy bundle (4 intents)"
      contains: "bundleId"
    - path: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/policy-bundles/constrained-v1.json"
      provides: "Conservative intent policy bundle (3 intents)"
      contains: "bundleId"
    - path: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/intent-router.test.js"
      provides: "Jest test suite for GOV-02 intent router"
      exports: ["planIntent checkpoint_required test", "planIntent ready test", "getMcpAllowlist test"]
  key_links:
    - from: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/intent-router.js"
      to: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/mcp-policy.js"
      via: "require('./mcp-policy')"
      pattern: "require.*mcp-policy"
    - from: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/intent-router.js"
      to: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/policy-bundles/"
      via: "DEFAULT_BUNDLE_DIR using PROJECT_ROOT"
      pattern: "DEFAULT_BUNDLE_DIR.*PROJECT_ROOT"
    - from: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/mcp-policy.js"
      to: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/mcp-allowlists.json"
      via: "PROJECT_ROOT path resolution"
      pattern: "mcp-allowlists\\.json"
---

<objective>
Port mcp-policy.js, intent-router.js, and all four config files from thumbgate into Subway_RN_Demo with path-variable surgery, then write the intent-router Jest test suite.

Purpose: GOV-02 covers risk-stratified intent planning. mcp-policy.js and the config files are prerequisites for intent-router.js — they ship together. This plan runs in parallel with Plan 01 (no shared files).

Output:
- .claude/scripts/feedback/mcp-policy.js (Subway copy)
- .claude/scripts/feedback/intent-router.js (Subway copy)
- .claude/config/mcp-allowlists.json
- .claude/config/subagent-profiles.json
- .claude/config/policy-bundles/default-v1.json
- .claude/config/policy-bundles/constrained-v1.json
- scripts/__tests__/intent-router.test.js (Jest, GOV-05)
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
@/Users/ganapolsky_i/workspace/git/igor/ThumbGate/scripts/mcp-policy.js
@/Users/ganapolsky_i/workspace/git/igor/ThumbGate/scripts/intent-router.js
@/Users/ganapolsky_i/workspace/git/igor/ThumbGate/config/mcp-allowlists.json
@/Users/ganapolsky_i/workspace/git/igor/ThumbGate/config/subagent-profiles.json
@/Users/ganapolsky_i/workspace/git/igor/ThumbGate/config/policy-bundles/default-v1.json
@/Users/ganapolsky_i/workspace/git/igor/ThumbGate/config/policy-bundles/constrained-v1.json
@/Users/ganapolsky_i/workspace/git/igor/ThumbGate/tests/intent-router.test.js
</context>

<tasks>

<task type="auto">
  <name>Task 1: Port config files and mcp-policy.js to Subway</name>
  <files>
    /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/mcp-allowlists.json
    /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/subagent-profiles.json
    /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/policy-bundles/default-v1.json
    /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/policy-bundles/constrained-v1.json
    /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/mcp-policy.js
  </files>
  <action>
    STEP 1 — Create directory structure:
      mkdir -p /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/policy-bundles/
      mkdir -p /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/

    STEP 2 — Copy config files verbatim:
    Read each source config file and write it to the Subway destination WITHOUT modification:
    - /Users/ganapolsky_i/workspace/git/igor/ThumbGate/config/mcp-allowlists.json
      → /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/mcp-allowlists.json
    - /Users/ganapolsky_i/workspace/git/igor/ThumbGate/config/subagent-profiles.json
      → /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/subagent-profiles.json
    - /Users/ganapolsky_i/workspace/git/igor/ThumbGate/config/policy-bundles/default-v1.json
      → /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/policy-bundles/default-v1.json
    - /Users/ganapolsky_i/workspace/git/igor/ThumbGate/config/policy-bundles/constrained-v1.json
      → /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/policy-bundles/constrained-v1.json

    Add a comment at the top of each policy-bundles JSON file (or inline if JSON doesn't support comments — use
    a top-level "_comment" key):
      "_comment": "Tool names are ThumbGate-origin; update to Subway-specific tools in a future cleanup pass"

    STEP 3 — Port mcp-policy.js with PATH SURGERY:
    Read /Users/ganapolsky_i/workspace/git/igor/ThumbGate/scripts/mcp-policy.js

    Create /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/mcp-policy.js
    with this change:
      Change PROJECT_ROOT from:
        const PROJECT_ROOT = path.join(__dirname, '..');
      To:
        const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');

    Add comment: // Subway: 3 levels up — .claude/scripts/feedback/ → .claude/scripts/ → .claude/ → Subway_RN_Demo/

    Verify the config files are resolvable from mcp-policy.js:
      node -e "
        const path = require('path');
        const d = '/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback';
        const root = path.join(d, '..', '..', '..');
        const allowlistPath = path.join(root, '.claude', 'config', 'mcp-allowlists.json');
        console.log('resolves to:', allowlistPath);
        console.log('exists:', require('fs').existsSync(allowlistPath));
      "
    Expected: exists: true

    Load mcp-policy.js and verify it works:
      node -e "
        const mp = require('/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/mcp-policy');
        console.log('exports:', Object.keys(mp));
      "
    Expected: exports array containing getMcpAllowlist (or similar)
  </action>
  <verify>
    # Config files exist and parse as valid JSON
    node -e "
      ['mcp-allowlists.json','subagent-profiles.json'].forEach(f => {
        const p = '/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/' + f;
        JSON.parse(require('fs').readFileSync(p,'utf8'));
        console.log(f, 'OK');
      });
      ['default-v1.json','constrained-v1.json'].forEach(f => {
        const p = '/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/policy-bundles/' + f;
        JSON.parse(require('fs').readFileSync(p,'utf8'));
        console.log(f, 'OK');
      });
    "
    Expected: all 4 files print OK

    # mcp-policy.js loads without error and has correct PROJECT_ROOT
    node -e "const mp = require('/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/mcp-policy'); console.log('loaded:', typeof mp);"
    Expected: loaded: object (no errors thrown)

    grep "path.join(__dirname.*\.\." /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/mcp-policy.js
    Expected: path.join(__dirname, '..', '..', '..')
  </verify>
  <done>
    - 4 config JSON files exist in .claude/config/ and .claude/config/policy-bundles/
    - All 4 parse as valid JSON
    - mcp-policy.js loads in Node without error
    - mcp-policy.js PROJECT_ROOT uses 3-level join
    - path to mcp-allowlists.json resolves to an existing file
  </done>
</task>

<task type="auto">
  <name>Task 2: Port intent-router.js and write intent-router Jest test suite</name>
  <files>
    /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/intent-router.js
    /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/intent-router.test.js
  </files>
  <action>
    PART A — Port intent-router.js:

    Read /Users/ganapolsky_i/workspace/git/igor/ThumbGate/scripts/intent-router.js

    Create /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/intent-router.js
    with these changes:

    1. PATH SURGERY:
       Change PROJECT_ROOT from path.join(__dirname, '..') to path.join(__dirname, '..', '..', '..')
       Add comment: // Subway: 3 levels up from .claude/scripts/feedback/

    2. DEFAULT_BUNDLE_DIR must resolve to .claude/config/policy-bundles/ in Subway:
       Verify the existing DEFAULT_BUNDLE_DIR line reads something like:
         const DEFAULT_BUNDLE_DIR = path.join(PROJECT_ROOT, 'config', 'policy-bundles');
       With the corrected PROJECT_ROOT, this becomes:
         Subway_RN_Demo/config/policy-bundles   ← WRONG — must be .claude/config/policy-bundles

       Fix by changing DEFAULT_BUNDLE_DIR to:
         const DEFAULT_BUNDLE_DIR = path.join(PROJECT_ROOT, '.claude', 'config', 'policy-bundles');
       Reason: In ThumbGate, config/ is at repo root. In Subway, config is under .claude/. The PROJECT_ROOT
       path is the same (repo root), but the config subpath differs.

    3. The require('./mcp-policy') line stays as-is — relative path works since both files are
       in the same .claude/scripts/feedback/ directory.

    4. No other logic changes.

    Verify intent-router.js loads and planIntent is callable:
      node -e "
        const ir = require('/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/intent-router');
        console.log('planIntent type:', typeof ir.planIntent);
      "
    Expected: planIntent type: function

    PART B — Write Jest test suite for intent-router (GOV-05):

    Read /Users/ganapolsky_i/workspace/git/igor/ThumbGate/tests/intent-router.test.js for coverage ideas.

    Create /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/intent-router.test.js

    Use Jest syntax. Unlike budget-guard (which needs tmpDir isolation), intent-router reads config
    files from .claude/config/ — those are static during tests. Use jest.resetModules() in beforeEach
    to ensure fresh module state between tests.

    CRITICAL: The test must set the working path context so intent-router.js finds its config files.
    Do NOT mock the filesystem for policy bundles — the actual config files exist in Subway at
    .claude/config/policy-bundles/. Read them for real.

    Test structure:
    ```javascript
    let intentRouter;

    beforeEach(() => {
      jest.resetModules();
      intentRouter = require('../../.claude/scripts/feedback/intent-router');
    });
    ```

    Required test cases:
    1. "planIntent returns checkpoint_required when approved=false for gated intent" —
       call planIntent({ bundleId: 'default-v1', mcpProfile: 'default', intentId: <a gated intent from default-v1.json>, approved: false })
       Read default-v1.json to find an intent with a checkpoint condition.
       Expect result.status === 'checkpoint_required' (or equivalent per actual API)

    2. "planIntent returns ready when approved=true" —
       same intent, approved: true
       Expect result.status === 'ready' (or equivalent per actual API — read the source to confirm)

    3. "planIntent throws or returns error for unknown bundleId" —
       call planIntent({ bundleId: 'nonexistent-bundle', mcpProfile: 'default', intentId: 'test' })
       Expect it to throw or return a result with status === 'error' or 'unknown'

    4. "getMcpAllowlist returns allowlist for default profile" (if mcp-policy exports this) —
       const { getMcpAllowlist } = require('../../.claude/scripts/feedback/mcp-policy');
       const list = getMcpAllowlist('default');
       Expect list to be an array with at least one entry

    Note: Read intent-router.js source carefully before writing tests. Use the ACTUAL exported
    function names and ACTUAL bundle intent IDs from default-v1.json.
  </action>
  <verify>
    # Verify intent-router.js loads and has correct path surgery
    node -e "const ir = require('/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/intent-router'); console.log(typeof ir.planIntent);"
    Expected: "function"

    grep "DEFAULT_BUNDLE_DIR" /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/intent-router.js
    Expected: .claude/config/policy-bundles in the path expression

    grep "path.join(__dirname.*\.\." /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/intent-router.js
    Expected: path.join(__dirname, '..', '..', '..')

    # Run intent-router Jest tests in Subway
    cd /Users/ganapolsky_i/workspace/git/Subway_RN_Demo && npx jest scripts/__tests__/intent-router.test.js --no-coverage 2>&1 | tail -15
    Expected: Tests: N passed, 0 failed

    # Smoke test planIntent with a real bundle
    node -e "
      const { planIntent } = require('/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/intent-router');
      const dv1 = require('/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/policy-bundles/default-v1.json');
      const firstIntent = dv1.intents ? dv1.intents[0].id : Object.keys(dv1)[0];
      console.log('first intent id:', firstIntent);
      const r = planIntent({ bundleId: 'default-v1', mcpProfile: 'default', intentId: firstIntent, approved: true });
      console.log('result status:', r.status || r);
    "
    Expected: prints a status without throwing
  </verify>
  <done>
    - intent-router.js in Subway loads without error; planIntent is a function
    - DEFAULT_BUNDLE_DIR resolves to .claude/config/policy-bundles/ (not config/policy-bundles/)
    - PROJECT_ROOT uses path.join(__dirname, '..', '..', '..')
    - intent-router.test.js has minimum 4 Jest test cases
    - All Jest tests pass with 0 failures
    - planIntent smoke test with approved:true succeeds without throwing
  </done>
</task>

</tasks>

<verification>
All intent-router and mcp-policy tests pass:
  cd /Users/ganapolsky_i/workspace/git/Subway_RN_Demo && npx jest scripts/__tests__/intent-router.test.js --no-coverage --verbose 2>&1 | tail -20

Config directory structure is correct:
  ls /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/
  Expected: mcp-allowlists.json  subagent-profiles.json  policy-bundles/

  ls /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/policy-bundles/
  Expected: default-v1.json  constrained-v1.json

Full dependency chain check — intent-router resolves mcp-policy which resolves config:
  node -e "
    const ir = require('/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/intent-router');
    console.log('planIntent:', typeof ir.planIntent);
  "
  Expected: planIntent: function (no ENOENT errors)

ThumbGate regression check:
  cd /Users/ganapolsky_i/workspace/git/igor/ThumbGate && npm test 2>&1 | grep -E "tests|pass|fail" | tail -5
  Expected: 60 node-runner tests, 0 failures
</verification>

<success_criteria>
1. mcp-policy.js in Subway loads without error; resolves mcp-allowlists.json at .claude/config/
2. intent-router.js in Subway loads without error; planIntent() is callable
3. DEFAULT_BUNDLE_DIR in intent-router.js resolves to .claude/config/policy-bundles/ (not config/policy-bundles/)
4. All 4 config files exist and parse as valid JSON
5. intent-router.test.js has minimum 4 Jest tests, all pass
6. planIntent({bundleId:'default-v1', approved:true}) succeeds without throwing
7. ThumbGate npm test still exits 0 with 60 node-runner tests (no regression)
</success_criteria>

<output>
After completion, create /Users/ganapolsky_i/workspace/git/igor/ThumbGate/.planning/phases/03-governance-into-subway/3-02-SUMMARY.md
</output>
