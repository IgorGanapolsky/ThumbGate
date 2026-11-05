---
"thumbgate": patch
---

Include the plugin PreToolUse entrypoint, its budget helper, its email-strategy evaluator, and four gate-check runtime modules in the npm package. Guard the shipped manifest paths and exercise gate-check in an extracted package. This repairs missing-module errors; host behavior after an error is not established by these package checks.
