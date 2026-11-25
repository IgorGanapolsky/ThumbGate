---
"thumbgate": patch
---

Model routing now says whether a task needs a reasoning step. Routine edits, tool loops and sub-agent work get `reasoningMode: "instruct"`; debugging, architecture and hard algorithmic or math work get `"thinking"`, and so does a task that failed twice without it. New local family `THUMBGATE_LOCAL_MODEL_FAMILY=mellum` maps roles to JetBrains' open-weights Mellum2.1 Instruct and Thinking models (Apache 2.0).
