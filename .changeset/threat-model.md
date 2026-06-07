---
"thumbgate": patch
---

Add `THREAT_MODEL.md` — an honest, public statement of what the PreToolUse hook enforces (policy + observability layer) versus what it cannot contain (execution one layer down: curl|bash, write-then-run, package-script wrappers, subprocess handoff), and the recommended architecture of pairing the policy layer with an OS/sandbox containment boundary. Documents the shipped `stateful-helper-script-bypass` gate as defense-in-depth, not a containment substitute. Answers the r/devops review of the enforcement model.
