# ThumbGate Product Counsel Checklist & Legal Architecture Framework

> **Notice & Disclaimer**: This document serves as a Product Counsel Checklist and legal architecture blueprint for ThumbGate engineering, product, and commercial operations. It outlines contract terms, risk allocations, privacy boundaries, IP disclosures, and marketing claim substantiations. It is intended for review and finalization by qualified startup/product legal counsel prior to enterprise outreach and commercial scaling.

---

## 1. Master Architecture & Commercial Surface Mapping

ThumbGate operates across three distinct commercial and technical surfaces:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          THUMBGATE PLATFORM                             │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
      ┌────────────────────────────┼────────────────────────────┐
      ▼                            ▼                            ▼
┌──────────────┐          ┌──────────────────┐        ┌──────────────────┐
│  LOCAL ENGINE│          │ $499 WORKFLOW    │        │ THUMBGATE.APP    │
│  (npm/MCP)   │          │ GATE IMPLEMENT.  │        │ (Cloud / Mobile) │
└──────────────┘          └──────────────────┘        └──────────────────┘
• Local CLI & MCP Server  • One-time service SOW    • Device pairing & VPS
• Local state & rules     • Tailored gate config    • Cloud runner execution
• Permissive MIT core     • Regression suite proof  • Multi-device leases
```

---

## 2. Terms of Service Architecture

### A. Structure: Master Services Agreement (MSA) + Product-Specific Modules
We recommend a unified **Master Services Agreement (MSA)** with three modular schedules:
- **Schedule A**: Local Software License & Pro Tier Terms
- **Schedule B**: Professional Services SOW ($499 Hardened Workflow Gate)
- **Schedule C**: Hosted Platform & Cloud Runner Terms (`thumbgate.app`)

---

### B. General Commercial Terms (All Surfaces)
1. **Account & Registration**: Requirements for accurate account data, credential security, and organizational authority.
2. **Billing, Fees & Renewals**: Subscription auto-renewals, payment rails (Stripe), tax obligations, and late-payment remedies.
3. **Trials & Free Tiers**: "As-Is" provision without SLA or indemnification during trial periods.
4. **Acceptable Use Policy (AUP)**: Strict prohibition against using ThumbGate to bypass third-party security, perform unauthorized penetration testing, reverse-engineer proprietary cloud runners, or execute illegal/malicious agent workloads.
5. **Support Boundaries**: Standard business-hours support vs. premium enterprise support contracts; explicitly excludes debugging custom customer LLM code outside configured gate parameters.
6. **Beta & Experimental Features**: Clearly designated as pre-release, subject to change without notice, and provided without warranty.
7. **Third-Party Model & Cloud Dependencies**: Disclaimer of liability for outages, API changes, rate limits, latency spikes, or model drift caused by upstream providers (Anthropic, OpenAI, Google, Perplexity, Railway, etc.).
8. **Limitation of Liability**: Direct damages capped at fees paid in prior 12 months (or $100 for free tier). Complete exclusion of indirect, consequential, punitive, or loss-of-data damages.
9. **Warranty Disclaimers**: Express disclaimer of ALL implied warranties, including merchantability, fitness for a particular purpose, and non-infringement.
10. **Governing Law & Dispute Resolution**: State of California / Delaware law, mandatory binding individual arbitration, and waiver of class actions.
11. **Termination**: Termination for convenience (30 days notice) or cause (immediate for material breach/AUP violation), with explicit data-offboarding obligations.

---

### C. Surface 1 Specifics: Local Engine & Governance Control Layer
* **Control Layer Disclaimer**: Terms must explicitly state that ThumbGate is an **action interdiction control layer**, *not* a guarantee or absolute firewall preventing 100% of unsafe actions, prompt injections, or agent failures.
* **Hard Deny vs. Warning Distinction**: Terms must reinforce that ThumbGate provides configurable interdiction levels (Warnings, Intercepts, Hard Denies). The actual enforcement outcome is governed strictly by customer configuration, strict mode enablement, supported integration compatibility, and customer pre-deployment testing.
* **Customer Configuration Responsibility**: The customer retains full responsibility for defining rule thresholds, maintaining context packs, testing gates in staging environments, and overriding warnings.

---

### D. Surface 2 Specifics: $499 Hardened Workflow Gate (Professional Service)
* **Narrow Deliverable Definition**:
  1. **One (1) Supported Workflow**: Scope limited to a single defined agent workflow (e.g., GitHub PR review gate, database write interdiction, or email dispatch barrier).
  2. **One (1) Configured Gate**: Production-ready ThumbGate rule configuration file and integration hook.
  3. **Regression Evidence Package**: Standardized verification suite output demonstrating zero-regression performance on customer-provided golden test cases.
  4. **Rollout & Rollback Specification**: Documented rollout plan and one-command rollback mechanism.
* **Customer Obligations**: Customer must provide timely access to workflow documentation, sample payloads/logs, golden test cases, and technical points of contact within five (5) business days.
* **Acceptance Criteria**: Acceptance occurs automatically upon delivery of the Regression Evidence Package meeting agreed golden test criteria, or three (3) business days after delivery unless written deficiency notices are provided.
* **Out-of-Scope / Reduction Failure Boundary**: If customer's custom workflow cannot be reduced to a supported ThumbGate interdiction gate due to unsupported protocols or custom un-exposed APIs:
  * Formal contract matches website refund boundary: full refund issued minus a standard non-refundable initial diagnostic fee ($99), OR conversion of fee to account credit for future support.

---

### E. Surface 3 Specifics: Hosted Platform & Cloud Runners (`thumbgate.app`)
* **Paired Devices & Mobile Apps**: Terms governing cross-device WebSocket/TLS pairing, mobile approval push notifications, and cryptographic lease management.
* **Eligible Workloads**: Definition of permissible background workloads on customer VPS / ThumbGate cloud runners (e.g., headless browser automation, PR validation, scheduled cron checks).
* **Offline Policies & Disconnection**: Behavior when paired devices lose connectivity (default: fail-closed / pause execution).
* **Failure & Duplicate-Execution Policy**: Cloud runners use lease locks to prevent double-execution; terms disclaim liability for delayed execution or retries resulting from network partition or worker restart.
* **Human-in-the-Loop Liability**: Terms explicitly affirm that **the customer (human operator) remains solely responsible** for evaluating context, approving pending actions, and verifying agent execution outcomes.

---

## 3. Privacy, Security & Data Processing (DPA) Architecture

### A. Data Processing & Privacy Boundary Matrix

| Data Surface | Data Collected / Processed | Storage Location | Privacy Boundary & Retention |
| :--- | :--- | :--- | :--- |
| **Local CLI / MCP Engine** | Code context, execution receipts, local lesson store | Local disk (`~/.thumbgate/`, `.claude/`) | **100% Local-First**. Zero workspace telemetry or code sent to ThumbGate servers. |
| **Account & Billing** | Name, email, company, Stripe customer ID, payment status | Stripe, Supabase / Auth Store | Processed strictly for account maintenance and billing. Retention: Life of account + 7 years (tax). |
| **Hosted App (`thumbgate.app`)**| Device IDs, push tokens, lease metadata, operational logs | Encrypted Cloud Database (PostgreSQL / Redis) | Operational metadata only. Logs auto-purged after 30 days. |
| **Feedback & Lessons** | Human quality signals (`thumbs_up`, `thumbs_down`, reasons) | Local disk / Optional opted-in telemetry | Local by default. Opt-in aggregated stats contain no customer code. |

---

### B. Enterprise DPA & Security Addendum Posture
* **Standard DPA**: Drafted in compliance with GDPR, CCPA/CPRA, and EU Standard Contractual Clauses (SCCs).
* **Subprocessors List**:
  * **Stripe, Inc.**: Payment processing and billing.
  * **Railway / AWS / GCP**: Infrastructure hosting for `thumbgate.app` API & cloud runners.
  * **PostHog / Plausible**: Anonymous aggregate telemetry (marketing surfaces only; zero product workspace data).
* **Incident Notification Terms**: Commitment to notify business customers within **72 hours** of confirming a security breach impacting customer personal or operational metadata.
* **Data Portability & Return**: Customer right to export local JSON schemas and request complete deletion or machine-readable export of cloud account data within 30 days of termination.
* **Data Deletion & Retention**: Defined retention windows for account, billing, logs, support, and local data.

---

## 4. Trademark & Intellectual Property Hygiene

### A. Trademark Clearance & Brand Hierarchy
* **Primary Mark**: "ThumbGate" (word mark and icon logo).
* **Clearance Search Recommended**: Perform formal USPTO / EUIPO clearance searches in International Classes:
  * **Class 9**: Downloadable software, security control layer, AI agent governance tools.
  * **Class 42**: SaaS, cloud runner orchestration, agent monitoring platform.
* **Brand Family Distinction**:
  * `thumbgate.ai`: Marketing, developer documentation, and open-source landing hub.
  * `thumbgate.app`: Hosted web application, cloud runner dashboard, and mobile device pairing service.

### B. Third-Party Brand & Trademark Disclaimers
* All third-party names, trademarks, logos, and frameworks (including **Anthropic, Claude, OpenAI, ChatGPT, Cursor, Codex, Perplexity, Hermes, Model Context Protocol (MCP), GitHub, Google, Nvidia**) are the property of their respective owners.
* **Explicit Disclaimer**: Use of third-party marks in documentation or marketing is strictly for compatibility identification and nominative fair use. ThumbGate is an independent product and is NOT affiliated with, endorsed by, or sponsored by any of these third-party entity owners.

---

## 5. Copyright, Open-Source & License Hygiene

### A. Core vs. Commercial Boundary
* **Public Repository (`IgorGanapolsky/ThumbGate`)**: Licensed under the **MIT License**. Permissive open-source use for local engine and standard MCP hooks.
* **Proprietary Commercial Boundary**: Hosted cloud runners (`thumbgate.app` backend), enterprise multi-tenant adapters, proprietary policy sync engines, and commercial dashboard binaries remain closed-source and proprietary.

### B. Copyright & Contributor Hygiene
* **Contributor License Agreement (CLA)**: Implement Developer Certificate of Origin (DCO) or CLA requiring all external contributors to license/assign rights necessary for inclusion in dual-licensed distributions.
* **Asset Audit**: Verify all website images, icons, fonts (Google Fonts), and demo videos are properly licensed for commercial distribution.
* **Third-Party Attribution**: Ship `THIRD_PARTY_NOTICES.md` in root and npm packages acknowledging all open-source npm dependencies and their respective licenses (MIT, Apache 2.0, BSD).

---

## 6. Marketing Claims & Technical Substantiation Matrix

Every high-impact claim on marketing and product surfaces must map strictly to automated test suites, documented code scopes, and explicit legal caveats:

| Marketing Claim | Technical Implementation & Evidence | Documented Limitation / Legal Caveat |
| :--- | :--- | :--- |
| **"Hard Allow / Deny Interdiction"** | Validated by unit & integration tests (`tests/gate-program.test.js`, `tests/api-server.test.js`) where strict rules throw exit code 1 or block tool calls. | Hard denies require correct gate configuration, active MCP/hook wiring, and strict mode enabled by customer. |
| **"Encrypted Pairing & Leases"** | TLS 1.3 WebSocket pairing, cryptographic session lease tokens stored locally (`.git/thumbgate-session-lease.json`). | Security depends on customer maintaining physical/device security of paired endpoints. |
| **"Fenced Cloud Runner / VPS"** | Isolated container environment with restricted egress rules and ephemeral workspaces. | Cloud runner isolation is bounded by container runtime security limits; customer must audit executed workloads. |
| **"No Double-Write / Lease Lock"** | Single-Writer Checkout Lease protocol (`scripts/session-lease.js`) preventing concurrent git mutations. | Enforced per-checkout; requires agents to respect lease claim protocol. |
| **"Self-Improving Firewall"** | Local lesson capture (`capture_feedback`) auto-promoting quality signals into local prevention rules (`prevention_rules`). | **Clarification**: "Self-improving" refers strictly to local rule generation from human feedback, NOT underlying LLM weights fine-tuning or unvetted autonomous model training. |
| **"Zero Workspace Telemetry"** | Code stays local (`~/.thumbgate/`, `.claude/`); zero code contents sent to remote servers. | Applies to workspace code and file contents. Account registration and cloud runner metadata are processed per Privacy Policy. |

---

## 7. Employment, Non-Compete & Invention Assignment Boundaries

### A. ECI Employment Conflict Policy
The founder's employment agreement with ECI imposes broad confidentiality and
invention-assignment obligations. Because ECI's business overlaps with agentic
AI development and engineering acceleration, ThumbGate must be built and
maintained under a strict separation firewall:

- No ECI source code, architecture, prompts, skills, or internal tooling may be
  used in ThumbGate.
- No ECI customer failures, evaluation data, roadmaps, internal policies, or
  lessons learned may be incorporated, even in anonymized form.
- All ThumbGate commits must be demonstrably created on the contributor's own
  time using their own equipment, and from independent or publicly available
  sources.

See `docs/legal/ECI_EMPLOYMENT_BOUNDARY_POLICY.md` for the full operating policy.

### B. Contribution Attestation
The `CONTRIBUTING.md` DCO/CLA workflow requires any contributor subject to a
conflicting employment or invention-assignment obligation to certify the
own-time, no-confidential-information boundary for each contribution.

---

## 8. Recommended Action & Implementation Sequence

```
Step 1: Product & Data-Flow Mapping (COMPLETED in this document)
  │
Step 2: Legal Counsel Package Review
  ├── Submit Terms of Service Draft to Product Counsel
  ├── Submit Privacy Policy, DPA & Subprocessor List
  ├── Submit Trademark Clearance Request for "ThumbGate"
  └── Review Claims Substantiation Matrix against live tests
  │
Step 3: In-Repo Legal Compliance Implementation (IN PROGRESS)
  ├── Publish /docs/legal/TERMS_OF_SERVICE_DRAFT.md
  ├── Publish /docs/legal/PRIVACY_POLICY_AND_DPA.md
  ├── Publish /docs/legal/CLAIMS_SUBSTANTIATION_MATRIX.md
  ├── Publish THIRD_PARTY_NOTICES.md with dependency and trademark notices
  ├── Publish CONTRIBUTING.md with CLA/DCO sign-off requirement
  └── Add public legal links and third-party trademark disclaimers to website footers
  │
Step 4: Lawyer Review & Approval
  ├── Counsel review of MSA + Modules, Privacy Policy, DPA, AUP
  ├── Trademark clearance search in Classes 9 and 42
  ├── CLA/DCO integration in pull request workflow
  └── Final sign-off before enterprise outreach or commercial feature activation
```

---

## 9. Open Items Requiring Counsel / External Action

The following items **cannot be finalized by engineering** and must be addressed by qualified legal counsel or external service providers before commercial activation:

1. **Trademark Clearance Search**: Formal USPTO / EUIPO search for "ThumbGate" word mark and logo in Classes 9 and 42; registration strategy and conflict opinion.
2. **Lawyer Review of ToS/DPA**: Human attorney review of the draft Terms of Service, Privacy Policy, Data Processing Addendum, and Acceptable Use Policy.
3. **SOC 2 / Penetration Test Evidence**: Obtain or generate current SOC 2 Type II report, penetration test summary, and security audit artifacts for enterprise DPA audit requests.
4. **CLA/DCO Bot**: Configure the repository to enforce Signed-off-by lines on pull requests (e.g., via GitHub DCO app or CI check).
5. **Insurance**: Confirm appropriate E&O / cyber liability coverage for hosted services and professional services before broad enterprise outreach.
6. **Payment Terms Finalization**: Confirm Stripe refund mechanics, tax treatment, and billing cadence match the drafted ToS and the live checkout flow.
7. **Jurisdiction / Venue**: Validate Delaware governing law and AAA arbitration clause against target customer geographies and counsel advice.
8. **ECI Employment / Non-Compete Review**: Obtain qualified employment counsel review of the ECI agreement and the boundary policy in `docs/legal/ECI_EMPLOYMENT_BOUNDARY_POLICY.md`; confirm that ThumbGate's scope does not trigger invention-assignment or non-compete obligations and that every future commit can satisfy the own-time, no-ECI-confidential-information test.

