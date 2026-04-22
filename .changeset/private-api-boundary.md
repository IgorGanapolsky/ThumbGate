---
"thumbgate": patch
---

Keep the public ThumbGate server package resilient when private orchestration modules are absent by lazy-loading intent routing, handoff, hosted-job, and workflow-sprint surfaces instead of shipping them in the npm tarball.
