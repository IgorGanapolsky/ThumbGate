# Commercial Truth

Status: current for packaging and runtime capabilities; live traction requires authenticated telemetry
Updated: November 25, 2026

This document is the source of truth for product, pricing, traction, and proof claims in this repository.

## What is true today

- The open-source `thumbgate` package is free and MIT licensed.
- The local CLI is the adoption wedge; it is not the primary monetization story.
- The only promoted team offer is the **request-only 30-day team pilot** at `/pilot`. A team submits its name, work email, team size and coding agent through `POST /v1/intake/pilot-request`; the request is stored and the owner is emailed. A person replies by email with how the pilot would run. There is no public price and no self-serve team checkout. A pilot request is not revenue.
- **Pro at $19/mo or $149/yr** is the only self-serve paid software, for one person. Enterprise remains proposal-only after qualification.
- The `$499` Setup Sprint (also sold as the Sprint Diagnostic, managed workflow gate or Diagnostic Gate) and the `$1,500` Setup Sprint are retired (Igor, 2026-11-25). Their routes (`/diagnostic`, `/go/diagnostic*`, `/go/sprint`, `/go/operator-diagnostic`, `/checkout/sprint`, `/checkout/diagnostic`) answer 410, and `/founders` redirects to `/pilot`. Do not advertise either as a current offer. Legacy Stripe Payment Links must remain deactivated or undistributed.
- Stripe revenue attribution never relies on a product name. `scripts/stripe-revenue-catalog.js` binds each reviewed offer to its exact price ID, product ID, integer amount, currency, cadence, and interval. The retired `$499` catalog entry (Stripe product name `Setup Sprint`) stays in the catalog only so historical payments still reconcile. `npm run stripe:catalog-audit` verifies the live prices, product/price active states, mode, and Payment Links without mutating Stripe. Catalog configuration is not payment evidence.
- Active CLI receipts, paywall messages, SEO generators, email drafts, and social launch drafts must use first-party `thumbgate.ai` buyer paths. Raw Stripe or PayPal links are provider plumbing, not buyer-facing distribution assets. Retired kit catalogs are archived and cannot advertise their historical Payment Links as current offers.
- Zernio is retired for ThumbGate publishing. Its historical adapter is read-only; every publish, schedule, upload, or delete mutation fails closed before a network request. Active publishing requires a direct platform adapter or an explicitly approved manual platform session.
- Recurring and Enterprise service work is proposal-only after qualification: **Workflow Reliability Operations at $3,000/month for one proof-backed workflow**, a **$15,000 30-day Enterprise Governance Pilot for up to three local workflows**, and **Enterprise Reliability Operations at $10,000/month for the same three workflows after a completed pilot**. There is no public checkout for these services. Every engagement requires a signed scope, and service revenue counts only after provider-confirmed payment. Generic self-serve subscription MRR remains a separate provider-subscription metric. Hosted team lesson sync and a hosted org dashboard are not general-availability features in the current public runtime. The former Team seat tier is retired.
- Productized recurring and Enterprise milestones are stricter than generic MRR. They require a SHA-256-bound signed-scope reference naming the exact catalog offer, amount, cadence, and bounded workflow count, plus a linked provider-paid sales record whose buyer email, offer, amount, currency, reference, source, and digest reconcile exactly. A productized recurring milestone additionally requires the provider-returned invoice ID, a stated 27–32 day billing period, and a payment inside that period or its seven-day prepayment window. The invoice ID is authenticated by the provider response; the period dates are locally supplied contract-schedule fields checked against the payment timestamp, not independently fetched from an invoicing platform. A permitted prepayment remains scheduled until the period starts, while an expired invoice stays historical commercial evidence; neither can satisfy the active-recurring milestone, and each renewal needs a new provider-paid sales record. The signed-scope control is a local reference-and-digest integrity check; it does not remotely query or independently authenticate an e-signature platform. The documented sprint diagnostic credit is accepted only when the same buyer's separate provider-paid `$499` diagnostic reconciles with the `$1,001` balance. A Pro subscription or unrelated payment cannot satisfy either expansion milestone. Enterprise Reliability Operations also requires the exact lead ID and canonical PII-safe digest of a same-buyer, signed, provider-paid, artifact-backed Enterprise Governance Pilot completed before the recurring scope; the recurring workflow count cannot exceed that pilot. This pilot lineage is revalidated before scope acceptance, before paid-team recognition, and during every commercial audit.
- The open-source runtime now supports history-aware lesson distillation from up to 8 prior recorded entries in the current Claude auto-capture path, linked 60-second feedback sessions, and reflector rule proposals across CLI, hosted API, Cursor, and Claude Desktop surfaces.
- The runtime now supports Workflow Sentinel blast-radius scoring plus Docker Sandboxes routing guidance for high-risk local actions, and the hosted path supports signed sandbox dispatch for isolated automations.
- Package publishing is governed by Changesets, SemVer, version-sync checks, and verification evidence; release claims should stay inspectable instead of being inferred from a diff.
- Current customer and revenue counts are not stored as static repository truth. Run `node scripts/revenue-status.js` and cite current figures only when it reports `Source: hosted-billing-summary`. The July 12, 2026 audit returned `Source: local-fallback` after a hosted-summary `401`, so this document makes no current traction claim.
- The `$1,000/hour` north-star is an operating target, not current traction. Run `node scripts/revenue-target-control.js` for the fail-closed target verdict. It requires exact daily product attribution, refund-adjusted cohort reconciliation, a matching production build SHA, and date-aligned evidence from every documented collection provider. Stripe individual-payment proof requires a live charge, paid Checkout Session, external payer identity, and exact catalog-matched line items to reconcile; a known price with drifted terms makes attribution unverified. The candidate PayPal lane remotely verifies and durably preserves payment webhooks; when fully configured, its automatic read-only audit also reconciles registered recent events with current capture/order detail, attribution, payer ownership, and refund state. That can prove an individual external payment without waiting for Transaction Search, but it deliberately leaves global PayPal revenue unknown because event history does not enumerate every balance-affecting movement or subscription. Pipeline credit must be created through `npm run sales:reconcile-payment`: PayPal remains the default, while Stripe requires `--provider stripe --payment <stripe-charge-id>`. The provider-derived buyer-email digest and immutable gross amount must match the lead's buyer and reviewed offer; Stripe also requires exactly one matching catalog offer ID. Missing or mismatched buyer identity, unknown amounts, unsupported lead offers, missing or multiple Stripe offer IDs, and cross-offer matches fail without pipeline mutation. Re-reconciliation updates partial refunds and retires fully refunded booked revenue while retaining the original buyer and offer binding; manual paid transitions and plausible-looking payment IDs fail closed. GitHub signed Marketplace plan-change events do not substitute for the official financial Transactions export. The Merchant-of-Record rail and all other providers use the contract in `docs/PROVIDER_REVENUE_EVIDENCE.md`; missing evidence is unknown rather than zero. Global arithmetic does not exist until all four provider slices reconcile.
- Revenue operator actions are derived from evidence rather than stage labels. A row enters a send-copy surface only when its current stage has a stage-appropriate receipt, the full acquisition route passes the zero-spend screen, event chronology permits one response, the 48-hour follow-up cooldown has elapsed when applicable, and the row carries an exact action-time approval phrase. Buyer replies and other high-intent stage signals older than 14 days are not warm same-day signals and remain held for fresh evidence or separate reactivation review; receipts or stage timestamps dated more than five minutes in the future fail closed. Sending another message does not refresh checkout, intake, booking, or reply intent. A fresh unverified label may receive read-only review priority, but only a fresh stage-appropriate receipt on a verified zero-cost route counts as same-day evidence priority. Placeholder evidence is rejected both when written and when durable state is audited. Raw `replied` labels, provider checkout objects, ambiguous marketplace costs, internal delivery steps, and already-followed-up conversations remain held or internal-only and are excluded from `operator-send-now` and team outreach copy.
- The sales pipeline is canonical repository-wide commercial state rather than branch-local scratch data. Linked Git worktrees resolve the primary checkout's `.thumbgate/sales-pipeline.jsonl` automatically, preventing a release or repair worktree from reporting a false empty pipeline. Explicit state paths, feedback directories, project scopes, and hosted volume mounts remain authoritative when isolation is intentional.
- The private operator close queue is `GET /v1/intake/workflow-sprint/queue`. It emits an exact draft and opaque approval phrase only after the shared qualification validator confirms a complete zero-spend review, the intake is current, material unknowns are closed, and the buyer understands the fixed price. Diagnostic close packets use the first-party `/diagnostic` path; Sprint, recurring, and Enterprise packets remain scope-first with no payment request before written acceptance. Queue output never authorizes a send or recognizes revenue, and unavailable public-core installations return an explicit capability error.
- A current `new` intake may receive a separate discovery packet containing at most three material fit questions, an opt-out, and an explicit no-payment boundary. The packet exists only for a valid contact path on the first-party zero-spend route, carries its own opaque action-time approval phrase, and fails closed for stale, non-new, invalid-contact, disqualified, or questionless records. Preparing it does not mark the lead contacted, qualified, replied, or paid.
- Operators read that queue with `npm run revenue:intake-queue -- --json`. Terminal output is aggregate and pseudonymous by default. Buyer details require an explicit absolute `--export-private` path, are created without overwrite at mode `0600`, and still do not authorize contact or recognize revenue.
- Engineering verification is strong and should be cited through `docs/VERIFICATION_EVIDENCE.md` and machine-readable proof reports.

## Product Tiers

### Free (local, `npx thumbgate serve`)

- 2 feedback captures/day, 10 total captures
- Up to 3 active auto-promoted prevention rules
- No recall or lesson search
- No exports (DPO, Databricks, HuggingFace)
- Bundled checks plus a local PreToolUse hook
- Warn-by-default enforcement: detected secret leaks and the `self-protect-kill` / `self-protect-env-override` command gates deny by default. Force-push, `git reset --hard`, `git clean -f`, `rm -rf` on home or root, and `DROP TABLE` also deny by default (hard floor). Fetch-and-run and direct guardrail-file edits warn and log by default. `THUMBGATE_STRICT_ENFORCEMENT=1` preserves deny decisions for every matched blocking rule.
- Local-first enforcement on the operator's machine
- MCP integrations for Claude Code, Cursor, Codex, Gemini CLI, Amp, Cline, OpenCode, and compatible agents

### Pro ($19/mo or $149/yr, hosted checkout on Railway)

- Personal local dashboard
- DPO export and advanced data exports
- Unlimited captures and custom checks with auto-promotion into prevention rules
- **The standard lane for solo operators and independent developers.**

### Enterprise services (qualified proposal only)

- $15,000 30-day Enterprise Governance Pilot for up to three local workflows after proof, authority, timing, and fit are confirmed
- $10,000/month Enterprise Reliability Operations for the same three workflows after a completed pilot
- Scoped approval boundaries, rollback planning, evidence requirements, local gate implementation, bounded regression updates, and rollout review
- Shared hosting, team sync, org dashboards, SSO, SIEM, compliance packaging, 24/7 monitoring, and incident-response SLAs are not included and are not general-availability features today

## Service Offer Ladder

### 30-day team pilot (request only)

- Buyer: a team rolling a coding agent (Claude Code, Cursor, Codex, Gemini or another) out to a handful to a few hundred people
- Buyer inputs: name, work email, team size and agent, through the form at `/pilot`
- What happens: the request is stored, the owner is emailed, and a person replies by email with how the pilot would run for that team
- No public price, no self-serve checkout, and no promise of hosted team sync, SSO or an org-wide dashboard

### Retired: Setup Sprint ($499 and $1,500 one-time)

- Retired on 2026-11-25. Not a current offer on any public surface. Historical payments and signed scopes still reconcile through the catalog and intake validators described above.

### Recurring and Enterprise expansion

- Pro remains the `$19/mo` or `$149/yr` individual subscription after a solo operator has evidence that the local workflow is useful.
- Workflow Reliability Operations is `$3,000/month` after a proof-backed pilot: one existing workflow, one 45-minute monthly evidence review, up to two small gate or regression updates, one incident or near-miss review, and one refreshed approval/rollback/proof packet. It excludes new integrations, 24/7 monitoring, incident-response SLAs, compliance certification, and hosted team features.
- The `$15,000` Enterprise Governance Pilot covers up to three local workflows over 30 days after signed scope, payment, and receipt of agreed inputs. The `$10,000/month` Enterprise Reliability Operations follow-on is available only after a completed pilot and remains bounded to those three workflows.
- These three expansion offers are `qualified_proposal_only`: no public checkout, no claim of general availability for hosted team features, and no service-revenue attribution before signed scope plus provider-confirmed payment.
- A diagnostic, intake, checkout session, pending invoice, or proposal is not revenue. Only provider-confirmed payment counts as booked service revenue. Self-serve recurring-product claims require an active provider subscription tied to a ThumbGate product; productized recurring-service claims require a current provider-paid recurring invoice reconciled under the stricter contract gate above.

## Data Processing & Telemetry Boundaries

- The free local CLI is local-first: feedback logs, memory logs, background-agent run ledgers, gate firings, and generated proof artifacts are written under the operator's ThumbGate feedback directory unless the operator explicitly routes a workflow through a hosted API. Hosted team lesson sync is not generally available.
- CLI telemetry is anonymous, best-effort product telemetry for command usage and runtime health. It uses a random local install ID, does not include raw feedback context, and can be disabled with `THUMBGATE_NO_TELEMETRY=1` or `DO_NOT_TRACK=1`.
- The public website uses first-party telemetry endpoints plus configured analytics surfaces for page views, CTA events, checkout starts, intake submissions, and newsletter signups. A diagnostic checkout start means the server accepted a valid email-backed POST and issued the external Payment Link redirect; it does not mean Stripe was loaded or payment completed. Treat all of these as hosted product analytics, not local enforcement or payment data.
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
- Keep provider scope explicit: Stripe-only product attribution cannot prove global ThumbGate revenue while another documented collection rail remains unaudited. Missing rail evidence is unknown, not zero.
- Use the admin billing summary and CLI CFO output to distinguish `bookedRevenueCents` from `paidOrders`; not every paid provider event carries a verifiable amount by default.
- Treat Stripe-reconciled charges as booked revenue proof; treat GitHub Marketplace paid events as booked revenue only when the webhook carries plan pricing or plan pricing is configured, otherwise treat them as paid-order proof until invoice amounts are reconciled.
- When legacy GitHub Marketplace rows were written before pricing capture shipped, repair them with `npx thumbgate repair-github-marketplace --write` once plan pricing is available; do not invent amounts without webhook evidence or configured plan prices.
- Treat `workflowSprintLeads` as pipeline evidence only. `completeWorkflowSprintIntakes` means the required form fields are present. `qualifiedWorkflowSprintLeads` additionally requires an evidence-based operator review covering severity, impact, urgency, authority, budget mechanism, offer fit, decision proof, next step, an actual evidence reference, and a verified zero-cost acquisition route before the lifecycle can advance to `qualified`. Neither count is revenue.
- Use `docs/VERIFICATION_EVIDENCE.md`, `proof/compatibility/report.json`, and `proof/automation/report.json` for engineering proof.
- When in doubt, prefer "early-stage" or "pilot" language over unverified traction claims.
 
