---
"thumbgate": patch
---

Self-protection now covers the learned-rule store. An agent can no longer `rm`, truncate, `sed` or `Write` over the gates a thumbs-down promoted (`auto-promoted-gates.json`), the claim rules, the send holds, `prevention-rules.md` or the feedback log in `.thumbgate/`, `.thumbgate-compat/`, `~/.thumbgate/projects/<name>/` or `.claude/memory/feedback/`. These writes hit the `self-protect-config` hard floor, which no bypass env lifts. Reads stay allowed, ThumbGate's own code still writes the files, and an operator can still grant a scoped, time-limited approval with the `approve_protected_action` MCP tool.
