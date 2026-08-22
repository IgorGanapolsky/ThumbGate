---
'thumbgate': patch
---

fix(tests): make `tests/gates-engine.test.js` hermetic against an inherited `THUMBGATE_STRICT_ENFORCEMENT`

Five tests in this suite assert the default warn-by-default posture but read the enforcement mode straight from the ambient process environment. When an operator or agent harness exports `THUMBGATE_STRICT_ENFORCEMENT=1`, strict mode turns every warn into a hard deny and replaces `additionalContext` with `permissionDecisionReason`, so those five fail on a clean tree with no code change — a false CI signal that points at the gate engine instead of at the environment.

The variable is now captured into the existing `ORIGINAL_ENV` block, deleted in `beforeEach`, and restored in `afterEach`, matching how this file already isolates `THUMBGATE_FEEDBACK_DIR`, `THUMBGATE_FEEDBACK_LOG`, `THUMBGATE_ATTRIBUTED_FEEDBACK`, and `THUMBGATE_GUARDS_PATH`. The three tests that deliberately exercise strict mode continue to set it themselves, so strict-mode coverage is unchanged.

Verified both directions: 203/203 pass with the variable set in the environment, and 203/203 pass with it absent. Test-only change; no runtime or packaged-bundle effect.
