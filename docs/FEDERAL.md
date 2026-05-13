# ThumbGate for Federal Agencies

**Status:** Pilot-ready posture. No FedRAMP authorization yet — see [Compliance Posture](#compliance-posture) for the honest current state and the path forward.

**Audience:** Federal agency CIOs/CTOs, agency AI use-case owners (per OMB M-24-10), SBIR program managers, and primes/integrators evaluating ThumbGate for government work.

---

## What ThumbGate offers a federal agency

ThumbGate is a **pre-action gate** for AI coding agents and autonomous tools. When an agent inside an agency development environment tries to take an action — push code, modify a database, call an external API, deploy a service — ThumbGate intercepts the call *before* it executes and decides whether to allow, require evidence, or block.

What that gives an agency:

1. **Auditable AI agent behavior.** Every gate decision is logged with the intent, the action attempted, the policy invoked, and the outcome. This is the artifact OMB M-24-10 §5(c) (risk management) and EO 14110 §10.1 (AI use inventory) ask for, generated continuously rather than reconstructed quarterly.
2. **Enforced agency-specific policy.** Generic LLM guardrails are vendor-controlled and opaque. ThumbGate policies are owned by the agency, written as code, version-controlled, and enforced locally before a tool call leaves the dev environment.
3. **Repeated-failure prevention.** A thumbs-down from an agency engineer becomes a permanent prevention rule. The same risky action never reaches the model on the next attempt — relevant for cost control and for documenting "we did not let the agent do X" in incident reports.
4. **Vendor-neutral.** Works with Claude Code, Cursor, Codex, Gemini CLI, Amp, Cline, OpenCode, and any MCP-compatible agent. No lock-in to a single model vendor.

ThumbGate is **not** a model, an evaluation harness for model outputs, or a federal data RAG system. It is a behavioral enforcement layer between the agent and the tools it can invoke.

---

## Compliance Posture (Honest Current State)

| Item | Status | Notes |
|---|---|---|
| FedRAMP authorization | ❌ Not authorized | Targeting Low baseline via agency sponsorship. Open to civilian agency sponsor conversations. |
| FISMA controls (NIST 800-53 Rev 5) | 🟡 Partial mapping (see below) | Public ThumbGate inherits Railway's controls for SaaS deployments; Core gov mode runs on-prem. |
| FIPS 140-2/3 validated crypto | 🟡 In Core gov mode only | Public ThumbGate uses Node.js native crypto; Core gov mode routes to a FIPS-validated provider when `THUMBGATE_DEPLOY=gov`. |
| Section 508 accessibility | 🟡 Dashboard pending audit | Landing pages and CLI output are screen-reader friendly; full WCAG 2.1 AA audit pending. |
| US persons + US data residency | ✅ For Core gov deployments | Public SaaS runs on Railway (US regions); Core gov mode is on-prem or government cloud only. |
| Supply chain (SLSA, SBOM) | ✅ SBOM generated per release | `proof/` directory ships an SBOM and dependency report with every npm publish. |
| Third-party LLM calls | 🟡 Public uses Claude API directly | Core gov mode replaces direct Claude calls with Bedrock GovCloud / Azure Government routing. No model call leaves an authorized boundary. |

**What this honestly means today:** an agency can pilot ThumbGate in an innovation-sandbox tier (e.g., a research enclave, an SBIR phase-I prototype) right now. Production deployment at IL4+ or against PII/CUI requires Core gov mode and an agency-sponsored ATO process.

---

## NIST 800-53 Rev 5 Control Mapping

ThumbGate directly supports the following control families. This list is conservative — controls listed here are ones ThumbGate produces evidence for, not ones it merely touches.

| Family | Control | How ThumbGate supports it |
|---|---|---|
| AC — Access Control | AC-3 Access Enforcement | PreToolUse hook physically blocks tool calls that violate policy, regardless of operator intent. |
| AC — Access Control | AC-6 Least Privilege | Per-gate scopes (`task-scope-required`, branch-governance) bind agent actions to declared task scope. |
| AU — Audit & Accountability | AU-2 Event Logging | Every gate decision (allow / require-evidence / block) is logged with timestamp, actor, action, policy, evidence. |
| AU — Audit & Accountability | AU-3 Content of Audit Records | Logs include the exact tool call payload, redacted of PII via the built-in PII scanner. |
| AU — Audit & Accountability | AU-12 Audit Record Generation | Audit logs are generated server-side and exportable in JSON Lines for ingestion into agency SIEM. |
| CM — Configuration Management | CM-3 Configuration Change Control | Branch governance gate requires explicit `releaseVersion` declaration before release/publish actions. |
| CM — Configuration Management | CM-7 Least Functionality | MCP allowlists (`config/mcp-allowlists.json`) constrain which agent tools are reachable per deployment profile. |
| IR — Incident Response | IR-4 Incident Handling | Hallucination detector + claim verification produces evidence trails for post-incident review. |
| RA — Risk Assessment | RA-5 Vulnerability Monitoring | Security scan tool surfaces known-bad patterns from the prevention rule library. |
| SI — System & Information Integrity | SI-4 System Monitoring | Continuous gate-decision telemetry surfaces anomalous agent behavior. |
| SI — System & Information Integrity | SI-7 Software Integrity | Prevention rules are version-controlled; integrity of the rule corpus is checkable via `npm run self-heal:check`. |

A formal **NIST 800-53 control implementation summary (CIS)** can be generated on request for an agency engaged in pilot scoping.

---

## OMB M-24-10 + EO 14110 Alignment

| Requirement | ThumbGate contribution |
|---|---|
| OMB M-24-10 §5(a) — Use case inventory | Gate-decision telemetry produces a continuous inventory of which AI tools are actively used, by whom, on what. |
| OMB M-24-10 §5(c) — Minimum risk management practices for safety- and rights-impacting AI | Pre-action gates enforce evidence requirements (read-before-write, output validation, human approval) before AI takes consequential action. |
| OMB M-24-10 §5(d) — Public AI use case disclosure | Audit logs are exportable in structured form for the annual disclosure cycle. |
| EO 14110 §10.1(b) — AI use inventory and risk assessment | Per-agent telemetry distinguishes predefined workflows, parallel fan-out, and open-ended agents — directly supporting risk categorization. |
| EO 14110 §4.2 — Dual-use foundation model accountability | Behavioral logs of model-driven actions provide evidence of how a foundation model is actually used inside an agency. |

ThumbGate does **not** claim to be a complete M-24-10 compliance solution. It produces a specific class of evidence (agent behavior) that an agency would otherwise have to construct by hand.

---

## Deployment Modes

ThumbGate ships two deployment profiles for federal work. The public open-source release is unchanged; federal capabilities are an additive Core profile, not a fork.

### Public ThumbGate (open source, unchanged)

- `npm install thumbgate` → local CLI enforcement.
- Railway SaaS dashboard at `thumbgate-production.up.railway.app`.
- Calls Claude API directly.
- Suitable for: agency open-source experimentation, SBIR Phase I prototyping in non-production enclaves, contractor evaluation.

### ThumbGate-Core Gov Mode (`THUMBGATE_DEPLOY=gov`)

- On-prem or government cloud install (AWS GovCloud, Azure Government, agency private cloud).
- LLM routing through Bedrock GovCloud or Azure Gov OpenAI — **never a direct public-internet model call**.
- FIPS-validated crypto provider.
- Audit log sink configurable to agency SIEM.
- Air-gapped install supported (no telemetry, no auto-update).
- Suitable for: production agency development environments, CUI-adjacent workflows, ATO-bound deployments.

The boundary between these two profiles is enforced by `tests/public-core-boundary.test.js`. See [Architectural Invariants](#architectural-invariants).

---

## Architectural Invariants — the Dev Product Cannot Regress

Federal expansion runs through ThumbGate-Core. The public open-source product (`npm i thumbgate`, the Railway dashboard, the GitHub-native dev experience) is the protected invariant. These five rules are pinned by regression tests:

1. **`npm i thumbgate` on a fresh machine works with zero federal env vars set.** No federal code path is reachable in the public bundle without explicit opt-in.
2. **Public CI matrix passes with Core absent.** No federal API key, no Core network call, no Core import is required for a green build.
3. **`THUMBGATE_DEPLOY=gov` is the only switch.** Federal-specific behavior activates on that flag; absent the flag, the runtime is byte-identical to the open-source release.
4. **Public bundle size does not grow from federal work.** Measured before/after every Core release; a delta over a published threshold blocks the public release.
5. **Public MCP tools (`gate_stats`, `recall`, `capture_feedback`, etc.) behave identically in both modes.** Dev users see no behavior change, ever.

Violation of any invariant blocks merge. Fix the violation, then pin the fix with a regression test in `tests/public-core-boundary.test.js`.

---

## Sequencing — What Gets Built When

The instinct to "build all the federal features now" kills small companies. ThumbGate's federal sequencing is customer-driven:

**Phase 0 — Now (no agency commitment required):**
- This positioning brief (`docs/FEDERAL.md`) — done.
- Public landing page at `thumbgate.ai/federal` — done.
- NIST 800-53 control mapping (above) — done.
- Boundary regression tests (`tests/public-core-boundary.test.js`) — to land in next release.

**Phase 1 — On first agency conversation (no contract required):**
- One-page CIS (control implementation summary) tailored to the agency's authorization boundary.
- SBOM + dependency provenance walkthrough.
- Air-gapped install rehearsal in a clean VM.

**Phase 2 — On signed pilot agreement:**
- `THUMBGATE_DEPLOY=gov` mode in Core.
- Bedrock GovCloud / Azure Gov LLM routing.
- FIPS-validated crypto provider.
- Agency SIEM audit-log sink.

**Phase 3 — On pilot success + sponsor commitment:**
- FedRAMP Low baseline package preparation.
- 3PAO engagement.
- ATO documentation set.

**Phase 4 — Pulled by demand only:**
- Federal RAG over agency policy corpora (chunking, hybrid retrieval, faithfulness eval, source-bound generation).
- Multimodal retrieval for screenshot/PDF/diagram evidence in agency workflows.

Phases 3 and 4 are real work but speculative without a customer. Building them on speculation is the documented failure mode of small federal vendors.

---

## How to Engage

ThumbGate is open to:

- **SBIR / STTR Phase I and II proposals** as the small-business technology partner.
- **Agency innovation pilots** in research enclaves or innovation labs.
- **Prime / SI evaluation** for inclusion in a larger AI governance offering.
- **Conversation only.** A 30-minute scoping call is not a sales pitch.

Reach out via the public landing page at `https://thumbgate.ai/federal` or directly to the maintainer listed in `package.json`.

---

## What ThumbGate Will Not Do

To save everyone time:

- **No "FedRAMP authorized" claim until it is true.** Authorization is a process, not a marketing badge.
- **No security-by-obscurity.** The enforcement engine is open source; only the agency's specific policy library and deployment configuration are private.
- **No re-collapsing the public/Core boundary.** Federal features that would degrade the open-source dev experience are not shipped.
- **No "AI for everything" pitch.** ThumbGate is a behavioral enforcement layer for agents the agency already uses. It does not replace existing governance, training, or oversight.

---

## Related Documents

- [`CLAUDE.md`](../CLAUDE.md) — overall product architecture, public/Core boundary rules, deployment verification gate.
- [`docs/COMMERCIAL_TRUTH.md`](./COMMERCIAL_TRUTH.md) — honest commercial state of ThumbGate.
- [`docs/VERIFICATION_EVIDENCE.md`](./VERIFICATION_EVIDENCE.md) — what claims ThumbGate makes about itself and how each is verified.
- [`config/mcp-allowlists.json`](../config/mcp-allowlists.json) — MCP profile policy file (default/readonly/locked; gov profile added in Phase 2).
- [`proof/`](../proof/) — automation, compatibility, and SBOM reports generated per release.
