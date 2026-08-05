---
"thumbgate": patch
---

fix(hooks): PreToolUse hook processes now emit schema-valid stdout. Allows are silent (empty stdout); denies emit exactly one JSON object whose root key is `hookSpecificOutput` with `permissionDecision: "deny"`. The previous root-level `{"decision":"allow"}` / `{"decision":"deny"}` shapes are not in Claude Code's hook-output schema (root `decision` only accepts `approve|block`) and surfaced as "Hook JSON output validation failed — (root): Invalid input" on every tool call in every session where the hook was registered directly. Also removes a phantom `formatHookDeny` import — it was never exported by financial-control-plane, so ERP-plane denies crashed with exit 1 (non-blocking) instead of denying with exit 2. The hook-contract test now validates stdout against the actual hook-output schema (allowed root keys, decision enums, hookSpecificOutput key set) instead of merely requiring parseable JSON.
