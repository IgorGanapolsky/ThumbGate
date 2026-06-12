---
"thumbgate": minor
---

Add `npx thumbgate hermes-gate` — a governance adapter for Nous Research's Hermes Agent. Hermes is a self-evolving agent that rewrites its own `SKILL.md` files during use; it exposes a documented `pre_tool_call` shell hook that pipes each pending tool call to an external command and reads a block/allow decision from stdout. `hermes-gate` implements that contract: it reads Hermes's tool-call JSON from stdin, runs the **same** gate pipeline as `gate-check` (secret guard, security scan, force-push / destructive / `skill_manage` / learned prevention rules), and emits `{"decision":"block","reason":...}` to veto a call or `{}` to allow it — so ThumbGate can gate Hermes's runtime tool calls, including silent skill overwrites, before they execute.

Because Hermes's `pre_tool_call` is binary (block or allow) with no warn channel, `hermes-gate` runs strict enforcement by default so a deny actually blocks; set `THUMBGATE_HERMES_WARN_ONLY=1` for advisory-only. The hook fails open by design (Hermes proceeds if it errors/times out). Ships `adapters/hermes/config.yaml` with the exact `~/.hermes/config.yaml` wiring (MCP tool exposure + `pre_tool_call` matcher covering `terminal|process|patch|write_file|skill_manage|execute_code`).
