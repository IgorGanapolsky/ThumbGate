# Wiring & readiness checklist — reference

Detailed reference for the thumbgate-doctor skill. Load only when you need to interpret a
specific failing check.

## `npx thumbgate doctor`
Audits the local wiring and prints a readiness verdict (exits non-zero unless `ready`). Checks
typically include:

| Check | Failure means | Fix |
|-------|---------------|-----|
| PreToolUse hook | gates can't intercept tool calls | `npx thumbgate init` |
| SessionStart hook | recall/primer doesn't run at session start | `npx thumbgate init` |
| MCP server registered | the `mcp__thumbgate__*` tools aren't available | `claude mcp add thumbgate -- npx -y thumbgate serve` |
| Lesson store present | no place to read/write lessons | `npx thumbgate init` |
| Statusline | no inline status; cosmetic, not blocking | optional statusline setup |

Add `--json` for a machine-readable report when scripting.

## `check_operational_integrity` MCP tool
Confirms the **runtime** enforcement path is live — i.e. the MCP server is reachable and the
server-side check pipeline responds — not just that local config files exist. A green doctor with a
failing integrity check means config is fine but the server isn't running (`npx thumbgate serve`).

## Reading the combined result
- doctor ✅ + integrity ✅ → fully wired; gates will fire.
- doctor ❌ → apply the printed fix (almost always `npx thumbgate init`).
- doctor ✅ + integrity ❌ → start/restart the MCP server.
- everything green but no blocks → not a wiring problem; it's a rules question (thumbgate-rules
  skill) or an enforcement-history question (thumbgate-blocked skill).

## Scope boundary
This skill diagnoses **setup only**. It does not list rules, show enforcement stats, or create
rules — route those to the thumbgate-rules, thumbgate-blocked, and thumbgate-guard skills
respectively.
