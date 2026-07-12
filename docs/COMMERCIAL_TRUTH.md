# Commercial Truth

Status: current for packaging and runtime capabilities; live traction requires authenticated telemetry
Updated: July 12, 2026

This document is the source of truth for product, pricing, traction, and proof claims in this repository.

## What is true today

- The open-source `thumbgate` package is free and MIT licensed.
- The local CLI is the adoption wedge; it is not the primary monetization story.
- The primary commercial motion is the **Workflow Hardening Sprint** for one workflow, followed by Enterprise scoping when approval boundaries, rollback requirements, and evidence ownership must be designed across operators.
- The current public self-serve commercial offer is **Pro at $19/mo or $149/yr** via Stripe checkout.
- Legacy one-time Stripe links are retained only for past buyers and are not a current public offer.
- Enterprise is the contact-sales tier: **custom pricing, scoped after intake**, and the public Enterprise path remains an **intake-led pilot for the first workflow**. Hosted team lesson sync and a hosted org dashboard are not general-availability features in the current public runtime. The former Team seat tier is retired.
- The open-source runtime now supports history-aware lesson distillation from up to 8 prior recorded entries in the current Claude auto-capture path, linked 60-second feedback sessions, and reflector rule proposals across CLI, hosted API, Cursor, and Claude Desktop surfaces.
- The runtime now supports Workflow Sentinel blast-radius scoring plus Docker Sandboxes routing guidance for high-risk local actions, and the hosted path supports signed sandbox dispatch for isolated automations.
- Package publishing is governed by Changesets, SemVer, version-sync checks, and verification evidence; release claims should stay inspectable instead of being inferred from a diff.
- Current customer and revenue counts are not stored as static repository truth. Run `node scripts/revenue-status.js` and cite current figures only when it reports `Source: hosted-billing-summary`. The July 12, 2026 audit returned `Source: local-fallback` after a hosted-summary `401`, so this document makes no current traction claim.
- Engineering verification is strong and should be cited through `docs/VERIFICATION_EVIDENCE.md` and machine-readable proof reports.

## Product Tiers

### Free (local, `npx thumbgate serve`)

- 2 feedback captures/day, 10 total captures
- Up to 3 active auto-promoted prevention rules
- No recall or lesson search
- No exports (DPO, Databricks, HuggingFace)
- Bundled checks plus a local PreToolUse hook
- Warn-by-default enforcement: detected secret leaks and the `self-protect-kill` / `self-protect-env-override` command gates deny by default. Force-push, `rm -rf`, fetch-and-run, and direct guardrail-file edits warn and log by default. `THUMBGATE_STRICT_ENFORCEMENT=1` preserves deny decisions for every matched blocking rule.
- Local-first enforcement on the operator's machine
- MCP integrations for Claude Code, Cursor, Codex, Gemini CLI, Amp, Cline, OpenCode, and compatible agents

### Pro ($19/mo or $149/yr, hosted checkout on Railway)

- Personal local dashboard
- DPO export and advanced data exports
- Unlimited captures and custom checks with auto-promotion into prevention rules
- **The standard lane for solo operators and independent developers.**

### Enterprise (custom pricing, scoped after intake)

- Workflow Hardening Sprint intake for one repeated failure and one accountable owner
- Scoped approval boundaries, rollback planning, evidence requirements, and rollout support
- Review of local dashboard, lesson, rule, and export evidence already produced by the public runtime
- Shared hosting, team sync, org dashboards, SSO, SIEM, and compliance packaging must be explicitly contracted and verified before they are described as delivered; they are not general-availability features today

## Data Processing & Telemetry Boundaries

- The free local CLI is local-first: feedback logs, memory logs, background-agent run ledgers, gate firings, and generated proof artifacts are written under the operator's ThumbGate feedback directory unless the operator explicitly routes a workflow through a hosted API. Hosted team lesson sync is not generally available.
- CLI telemetry is anonymous, best-effort product telemetry for command usage and runtime health. It uses a random local install ID, does not include raw feedback context, and can be disabled with `THUMBGATE_NO_TELEMETRY=1` or `DO_NOT_TRACK=1`.
- The public website uses first-party telemetry endpoints plus configured analytics surfaces for page views, CTA events, checkout starts, intake submissions, and newsletter signups. Treat those as hosted product analytics, not local enforcement data.
- Hosted checkout, newsletter, intake, product analytics, and API-key flows may process account, billing, email, and workflow-intake data through the hosted Railway/API path and configured payment or analytics providers.
- Any future contracted shared deployment must treat connector writes, customer-data workflows, telemetry exports, and shared lesson databases as approval-gated data-processing surfaces.
- Model candidate catalogs and routing guides, including GPT-5.5 evaluation, are benchmark and planning surfaces. They do not silently call provider APIs, change runtime defaults, or imply OpenAI account availability without customer credentials and an explicit integration path.
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
 
