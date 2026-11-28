---
'thumbgate': minor
---

ThumbGate hooks for the Claude Agent SDK. `thumbgateHooks()` from `thumbgate/adapters/claude-agent-sdk/index.js` (TypeScript types included) and `thumbgate_hooks()` from the copy-in Python helper plug into the SDK's `hooks` option. PreToolUse runs the same gate check as the Claude Code hook. PostToolUse redacts secrets from tool output through `updatedToolOutput` and flags text that reads like instructions to the model (prompt injection) with `additionalContext`, or removes it with `injection: 'strip'`. `thumbgate sdk-bridge` is the stdin bridge the Python helper calls.
