---
"thumbgate": patch
---

`thumbgate help` (and bare `thumbgate`) now shows a curated 8-command short surface — `init`, `capture`, `stats`, `lessons`, `explore`, `dashboard`, `doctor`, `pro` — instead of dumping ~70 subcommands, internal hooks, "Also available" specialists, global flags, every `explore` sub-mode, and 18 example invocations the moment a first-time user types it.

The full surface is still discoverable via `thumbgate help all` (also `--all` / `--full`), unchanged from before.

Test coverage rewritten: `tests/cli.test.js` now asserts the short surface in the default path and the full surface behind `help all`, with a negative assertion that deep-niche commands (`proactive-agent-eval-guardrails`, `repair-github-marketplace`, etc.) stay out of the default view.

Surfaced by a real customer screenshot on 2026-05-18: the default output was getting truncated at the terminal's right margin and reading as noise.
