---
"thumbgate": patch
---

fix(gates): harden GitHub Actions workflow dispatch decisions

`gh workflow run` is now classified as a governed high-risk action. Decision evaluation requires workflow-dispatch evidence for environment, workflow file, ref, HEAD SHA, and expected job, blocks mismatches before execution, and returns deliberation/consistency-check instructions for high-risk actions.

The public repository was also scrubbed of obsolete project-specific proof lanes and source comments so ThumbGate no longer carries unrelated customer/repo names in tracked files.
