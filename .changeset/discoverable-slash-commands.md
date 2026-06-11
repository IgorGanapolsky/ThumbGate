---
"thumbgate": minor
---

Add five discoverable `/thumbgate-*` slash-commands that surface ThumbGate's core enforcement value in the agent command palette — the same distribution lever that took GSD (get-shit-done) to 64k stars by exposing 67 browsable `/gsd-*` commands, while ThumbGate's value sat hidden behind MCP tools nobody browses.

The commands ship in `.claude/commands/` and are installed into every agent's palette (`.claude`, `.gemini`, `.antigravitycli`) by `thumbgate init`:

- `/thumbgate-guard` — turn the last agent mistake into a hard prevention rule (wraps `capture_feedback` + the `thumbgate force-gate` force-promote path).
- `/thumbgate-rules` — list the active prevention rules + lessons guarding this repo (wraps `prevention_rules`, `get_reliability_rules`, `search_lessons`).
- `/thumbgate-blocked` — show what's actually been blocked: gate stats + enforcement matrix (wraps `gate_stats`, `enforcement_matrix`).
- `/thumbgate-protect` — show branch/release governance and grant a scoped, expiring approval for protected-file actions (wraps `get_branch_governance`, `approve_protected_action`).
- `/thumbgate-doctor` — health-check the wiring: hooks, MCP, agent-readiness (wraps the existing `thumbgate doctor`).

Each is a thin wrapper over an existing MCP tool or CLI command — **no new enforcement logic**, just discoverability. README now positions these as "the guardrail layer for spec-driven agents," working alongside GSD / Spec-Kit rather than competing with them. Guarded by `tests/discoverable-skills.test.js`, which verifies every command's frontmatter and that `allowed-tools` reference only real registered MCP tools and real `bin/cli.js` subcommands.
