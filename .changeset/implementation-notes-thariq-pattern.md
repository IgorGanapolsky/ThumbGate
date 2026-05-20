---
"thumbgate": minor
---

Add `thumbgate notes` — a per-repo running implementation-notes capture for AI coding agents, inspired by the prompt pattern Anthropic's Thariq (@trq212) shared on X for Claude Code workflows.

The pattern: as an agent implements against a spec, ambiguities and tradeoffs come up. Capturing them as they happen — instead of relying on the agent's session memory — keeps the human in the loop without slowing the agent down. ThumbGate now persists those decisions to `.thumbgate/implementation-notes.{md,jsonl}` (gitignored) and can promote any entry to a durable lesson via the existing capture-feedback pipeline.

New surface:
- `thumbgate notes append --decision="..." [--tool=<name>] [--rationale="..."] [--signal=info|up|down] [--tags=a,b,c]`
- `thumbgate notes list [--limit=N] [--json]`
- `thumbgate notes show <id>`
- `thumbgate notes promote <id>` — calls the feedback-capture module to convert a note into a lesson.

Module: `scripts/implementation-notes.js` (dependency-injection on `capture` to stay free of hard imports from the feedback pipeline). 8 tests in `tests/implementation-notes.test.js`.

Hook integration (PostToolUse auto-append) is left for a follow-up so this PR can land standalone — the CLI surface is independently useful and exercised by tests.
