---
"thumbgate": minor
---

feat(governance): steal the ML-SecOps AI governance operating plan

The episode operating plan (music.youtube.com/watch?v=9aSJpOQGANM): start
with low-risk measurable use cases, establish visibility and ownership, add
continuous controls before expanding capability. All ten steps encoded as
deterministic enforcement primitives:

- registerUseCase(): complete CMDB-for-AI entries with validated risk tiers
- classifyFlow(): sensitive data barred from unapproved models / unmanaged
  browser sessions
- checkPilotScope(): constrained pilot types, exactly one success metric,
  no production modification
- assessBlastRadius(): named exposure surfaces + approval-gate requirements
- checkMachineIdentity(): least privilege, no birthrights, rotation <= 90d
- eventTaxonomy(): seven reportable event types with owner/severity/containment
- releaseGate(): blocks regression, permission broadening, missing monitoring
- checkKitchen(): five-function cross-functional review group
- tabletopScenario(): injection -> sensitive retrieval -> privileged tool call
