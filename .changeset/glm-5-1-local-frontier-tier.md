---
'thumbgate': minor
---

Add GLM 5.1 as a zero-cost local frontier tier. Self-hosting GLM 5.1 (open-source, SWE-Bench Pro SOTA) eliminates frontier API spend: `localFrontier` tier has `costMultiplier: 0.0` and no token budget enforcement. Set `THUMBGATE_LOCAL_MODEL_FAMILY=glm-*` to activate automatic frontier → localFrontier routing in `recommendExecutionPlan`.
