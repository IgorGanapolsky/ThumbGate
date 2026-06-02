---
"thumbgate": patch
---

Fix `knowledge-conflict-gate` hard-blocking unrelated work when memory is noisy. Previously, any action whose retrieved lessons had sentiment entropy > 0.7 returned `decision: 'deny'` — so a session with conflicting past lessons (e.g. lots of recent UpWork-touching memory) would block routine commands like `pip install`, `chmod`, and edits. Now the gate **warns by default** and only hard-blocks in opt-in strict mode (`THUMBGATE_STRICT_KNOWLEDGE_CONFLICT=1`) for genuinely destructive/external commands (`git push`, `npm publish`, `rm -rf`, deploys, …). Also adds a `permission-change-approval` exception for safe local credential-hardening (`chmod 600` on a key file). A governance gate must not turn noisy memory into a wall across all work.
