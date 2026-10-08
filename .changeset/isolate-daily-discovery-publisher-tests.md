---
"thumbgate": patch
---

Isolate daily discovery publisher tests from repository state, credentials, and the shared vault. Keep local outputs staged until Dev.to returns a valid publication receipt, so staging does not suppress retries. Hold retries, including forced runs, when Dev.to returns an ambiguous receipt until the remote outcome is reconciled.
