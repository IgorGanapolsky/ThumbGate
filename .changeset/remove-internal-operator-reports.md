---
"thumbgate": patch
---

Remove internal operator report, proof-artifact, and memory-log directories from the public repository, and extend the leak gate (gitignore, pre-commit hook, CI test) so they cannot return. Public guide/compare pages and the pro/landing templates now point their evidence links at docs/VERIFICATION_EVIDENCE.md instead of tracked proof-report JSON files.
