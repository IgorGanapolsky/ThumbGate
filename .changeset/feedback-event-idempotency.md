---
"thumbgate": patch
---

Deduplicate concurrent UserPromptSubmit and Claude-history feedback captures at the storage boundary so one user signal creates one feedback event, lesson, counter update, and SQLite record. Keep the npm runtime slim by excluding the repository-only GitHub social preview asset.
