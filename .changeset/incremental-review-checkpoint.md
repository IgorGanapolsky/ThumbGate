---
"thumbgate": patch
---

Add incremental dashboard review checkpoints so operators can mark the current state as reviewed and then see only new feedback, promoted lessons, and gate blocks that landed afterward. This ships the persisted review baseline, the dashboard checkpoint controls, and the `/v1/dashboard/review-state` API for reading and resetting the current checkpoint.
