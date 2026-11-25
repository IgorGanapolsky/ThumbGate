---
"thumbgate": patch
---

Adds a test that records, with no enforcement change, that in default mode a git commit with a staged fake AWS key is not denied (only the task-scope warning), that rm -rf ~/ is denied and that rm -rf ./src is not.
