# Commercial Truth

Status: current
Updated: April 10, 2026

This document is the source of truth for product, pricing, traction, and proof claims in this repository.

## What is true today

- The open-source `thumbgate` package is free and MIT licensed.
- The local CLI is the adoption wedge; it is not the primary monetization story.
- The primary commercial motion is the **Workflow Hardening Sprint** for one workflow, followed by Team expansion when shared enforcement, approval boundaries, and auditability matter across operators.
- The current public self-serve commercial offer is **Pro at $19/mo or $149/yr** via Stripe checkout.
- Legacy one-time Stripe links are retained only for past buyers and are not a current public offer.
- The current Team pricing anchor is **$49/seat/mo with a 3-seat minimum**, and the public Team path remains an **intake-led pilot for the first workflow** until hosted rollout scope is qualified.
- The open-source runtime now supports history-aware lesson distillation from up to 8 prior recorded entries in the current Claude auto-capture path, linked 60-second feedback sessions, and reflector rule proposals across CLI, hosted API, Cursor, and Claude Desktop surfaces.
- The runtime now supports Workflow Sentinel blast-radius scoring plus Docker Sandboxes routing guidance for high-risk local actions, and the hosted path supports signed sandbox dispatch for isolated team automations.
- Package publishing is governed by Changesets, SemVer, version-sync checks, and verification evidence; release claims should stay inspectable instead of being inferred from a diff.
- Verified cumulative booked revenue through March 19, 2026 is **$20.00** from `2` reconciled Stripe charges tied to the current product; there is no evidence of any additional same-day booked charge beyond that cumulative total.
- Engineering verification is strong and should be cited through `docs/VERIFICATION_EVIDENCE.md` and machine-readable proof reports.

## Product Tiers

### Free (local, `npx thumbgate serve`)

- 3 lifetime feedback captures
- 1 auto-promoted prevention rule
- No recall or lesson search
- No exports (DPO, Databricks, HuggingFace)
- 5 built-in checks plus local PreToolUse hook blocking
- Local-first enforcement on the operator's machine
- MCP integrations for Claude Code, Cursor, Codex, Gemini CLI, Amp, Cline, OpenCode, and compatible agents

### Pro ($19/mo or $149/yr, hosted checkout on Railway)

- Personal local dashboard
- DPO export and advanced data exports
- Review-ready workflow support for the first risky flow
- Unlimited custom checks with auto-promotion into prevention rules
- Secondary self-serve lane for solo operators, not the default enterprise pitch

### Team ($49/seat/mo, min 3, hosted rollout intake-first)

- Workflow hardening sprint as the first paid step
- Shared hosted lesson database
- Generated hosted review views for team, incident, and rollout operations
- Org dashboard with active agents, check hit rates, and risk agents
- Curated check template library
- Isolated execution guidance for risky local autonomy and signed hosted sandbox dispatch for team workflows
- Workflow hardening sprint intake and rollout support
- Team-wide sharing of prevention rules and proof artifacts

## Data Processing & Telemetry Boundaries

- The free local CLI is local-first: feedback logs, memory logs, background-agent run ledgers, gate firings, and generated proof artifacts are written under the operator's ThumbGate feedback directory unless the operator explicitly routes a workflow through hosted APIs or team sync.
- CLI telemetry is anonymous, best-effort product telemetry for command usage and runtime health. It uses a random local install ID, does not include raw feedback context, and can be disabled with `THUMBGATE_NO_TELEMETRY=1` or `DO_NOT_TRACK=1`.
- The public website uses first-party telemetry endpoints plus configured analytics surfaces for page views, CTA events, checkout starts, intake submissions, and newsletter signups. Treat those as hosted product analytics, not local enforcement data.
- Hosted checkout, newsletter, intake, team sync, and API-key flows may process account, billing, email, and workflow-intake data through the hosted Railway/API path and configured payment or analytics providers.
- Team/shared deployments should treat connector writes, customer-data workflows, telemetry exports, and shared lesson databases as approval-gated data-processing surfaces.
- ThumbGate should not claim sub-processor coverage, SOC 2 status, HIPAA eligibility, GDPR DPA terms, or enterprise data residency until those legal/compliance artifacts are actually in place.

## What we must not claim

- Do not treat GitHub stars, watchers, dependents, or npm download counts as customer or revenue proof.
- Do not present AI-agent self-validation as independent market proof.
- Do not use hardcoded scarcity or social-proof claims such as "spots remaining" or "founding members" unless they are backed by live data.
- Do not present historical pricing experiments as the current live offer.

## Proof policy

- Use booked revenue, paid orders, or named pilot agreements for commercial proof.
- Use the admin billing summary and CLI CFO output to distinguish `bookedRevenueCents` from `paidOrders`; not every paid provider event carries a verifiable amount by default.
- Treat Stripe-reconciled charges as booked revenue proof; treat GitHub Marketplace paid events as booked revenue only when the webhook carries plan pricing or plan pricing is configured, otherwise treat them as paid-order proof until invoice amounts are reconciled.
- When legacy GitHub Marketplace rows were written before pricing capture shipped, repair them with `npx thumbgate repair-github-marketplace --write` once plan pricing is available; do not invent amounts without webhook evidence or configured plan prices.
- Treat `workflowSprintLeads` as pipeline evidence only; qualified intake volume is useful for selling, but it is not revenue.
- Use `docs/VERIFICATION_EVIDENCE.md`, `proof/compatibility/report.json`, and `proof/automation/report.json` for engineering proof.
- When in doubt, prefer "early-stage" or "pilot" language over unverified traction claims.
 
