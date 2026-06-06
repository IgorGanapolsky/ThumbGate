---
"thumbgate": minor
---

Add `npx thumbgate quickstart` — a guided first-rule activation walkthrough that fixes the #1 funnel break: ~98.5% of `init` users never promote their first prevention rule, so they never reach the "ThumbGate just blocked a repeat mistake" aha moment. The command captures one real agent mistake, promotes it into a block rule (reusing the existing force-promote path), then immediately fires that rule against the action so the user watches it get blocked, and ties the value to what Pro keeps synced across machines and team. Additive and safe: `init` is untouched, the walkthrough runs in a TTY only, and non-interactive / piped / CI runs print a one-line hint and exit 0 without prompting or hanging.
