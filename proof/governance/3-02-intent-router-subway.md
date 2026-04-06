# Proof: GOV-02 Intent Router + GOV-05 Tests Ported to Subway

**Plan:** 3-02
**Date:** 2026-03-04
**Phase:** 03-governance-into-subway

## Files Ported to Subway_RN_Demo

| File | Source | Status |
|------|--------|--------|
| `.claude/scripts/feedback/mcp-policy.js` | `thumbgate/scripts/mcp-policy.js` | Ported with PATH SURGERY |
| `.claude/scripts/feedback/intent-router.js` | `thumbgate/scripts/intent-router.js` | Ported with PATH SURGERY |
| `.claude/config/mcp-allowlists.json` | `thumbgate/config/mcp-allowlists.json` | Copied verbatim |
| `.claude/config/subagent-profiles.json` | `thumbgate/config/subagent-profiles.json` | Copied verbatim |
| `.claude/config/policy-bundles/default-v1.json` | `thumbgate/config/policy-bundles/default-v1.json` | Copied + _comment key |
| `.claude/config/policy-bundles/constrained-v1.json` | `thumbgate/config/policy-bundles/constrained-v1.json` | Copied + _comment key |
| `scripts/__tests__/intent-router.test.js` | NEW — GOV-05 | 10 Jest tests |

## PATH SURGERY Applied

Both `.js` files had PROJECT_ROOT changed:
- **Before:** `path.join(__dirname, '..')`
- **After:** `path.join(__dirname, '..', '..', '..')`
  Comment: `// Subway: 3 levels up — .claude/scripts/feedback/ → .claude/scripts/ → .claude/ → Subway_RN_Demo/`

DEFAULT_BUNDLE_DIR in intent-router.js changed:
- **Before:** `path.join(PROJECT_ROOT, 'config', 'policy-bundles')`
- **After:** `path.join(PROJECT_ROOT, '.claude', 'config', 'policy-bundles')`

## Deviation: jest.scripts.config.js Created

The main `jest.config.js` has `testPathIgnorePatterns` that excludes `scripts/`.
Created `jest.scripts.config.js` to enable running governance tests in isolation.

Test command: `npx jest --config jest.scripts.config.js scripts/__tests__/intent-router.test.js --no-coverage`

## Verification Evidence

```
# Config files parse as valid JSON
node -e "... JSON.parse each ..."
mcp-allowlists.json OK
subagent-profiles.json OK
default-v1.json OK
constrained-v1.json OK

# mcp-policy.js loads
node -e "const mp = require('.../mcp-policy'); console.log('loaded:', typeof mp);"
loaded: object

# intent-router.js loads and planIntent is a function
node -e "const ir = require('.../intent-router'); console.log(typeof ir.planIntent);"
function

# planIntent smoke test
first intent id: capture_feedback_loop
result status: ready

# Jest tests (10 tests, 0 failures)
Tests: 10 passed, 0 failed
```

## ThumbGate Regression Check

```
npm run test:api => tests 58, pass 58, fail 0
npm test => tests 2 (proof), pass 2, fail 0
Total: 60 (unchanged from baseline)
```
