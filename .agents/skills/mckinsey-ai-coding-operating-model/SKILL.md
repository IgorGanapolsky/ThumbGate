---
name: mckinsey-ai-coding-operating-model
description: Operationalizes McKinsey's "What the Top Companies Do Differently With AI Coding" (Martin Harrysson, Prakhar Dixit, Shilpa — https://www.youtube.com/watch?v=21tuT-e4NVo) for 2x end-to-end engineering throughput: 1-2 day Night-Shift Kanban loops, standardized Spec/PRD inputs, progressive HITL removal, 2-4 person Definer/Builder/Verifier mini-pods, Golden Examples (>=P90) over codebase averages, tight vetted skill caps (<=7), sideways WCAG/colorblind/DLP/compliance PreToolUse guardrails, and AIOps Token ROI scoring.
---

# McKinsey Top-Company AI Coding Operating Model (`2x` End-to-End Throughput)

## 5 Mandatory Control Loops (`src/mckinsey-top-company-ai-coding.js`)

1. **1–2 Day Night-Shift Kanban Loops & Standardized Spec Inputs (`validateStandardSpecArtifact`, `evaluateProgressiveHitlGate`):**
   - Ditch 2-week Scrum sprints (`targetCycleHours <= 48`). Agents run the night shift; humans validate or auto-advance.
   - Require structured `problemStatement`, `verifiableOutcomes`, `goldenReferences`, `sidewaysConstraints`, and `tokenBudgetUsd` before code generation.
   - Progressively remove human sign-off (`requireHumanSignOff: false`) when `confidenceScore >= 0.85`, automated gates pass, and `blastRadius` is reversible.
2. **2–4 Person Mini-Pods & Review Parity (`auditPodTopologyAndReviewRatio`):**
   - Collapse narrow PM/Dev/QA silos into `definer`, `builder`, and `verifier` roles in `2–4` actor pods.
   - Enforce `reviewToGenerationRatio >= 0.50` and verified test assertions so faster AI generation never inflates per-PR bug rates.
3. **SME Semantic Layer, Golden Examples & Tight Vetted Skills (`curateContextGoldenExamplesAndSkills`):**
   - Feed top-decile **Golden Examples** (`qualityPercentile >= 90`, `passesArchitectureStandards: true`) and reject noisy codebase averages.
   - Cap active skills per loop at **`<= 7` centrally vetted skills** to prevent agent decision paralysis.
4. **Upstream, Downstream & Sideways Bottleneck Guardrails (`evaluateSidewaysEnterpriseGuardrails`):**
   - Wire agents directly to upstream customer emails/logs and downstream release checklists.
   - Bake **WCAG AA contrast (`>= 4.5:1`)**, **colorblind safety (never red/green hue alone)**, **corporate air-gap DLP (`CORP_AIRGAP_RE`)**, and **`pretool_diode_verified`** compliance directly into `<0.5ms` `PreToolUse` checks.
5. **AIOps Token ROI & Business Value Gate (`scoreTokenRoiAndBusinessImpact`):**
   - Score `totalBusinessValueUsd / effectiveTokenCostUsd` (`>= 10x` required, `>= 100x` = `P0_HIGH_ROI`) with `outboundCashSpendUsd === 0`.

## Verification Command

```bash
node --test tests/mckinsey-top-company-ai-coding.test.js
```
