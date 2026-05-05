# Revenue Close Room (Money Now)

Updated: 2026-05-05

This file is the close-room script + truth table for converting warm/high-intent leads into:

- Workflow Hardening Diagnostic (`$499`)
- Workflow Hardening Sprint (`$1500`)
- Pro (`$19/mo` or `$149/yr`)

Source of truth:

- Commercial truth + pricing: `docs/COMMERCIAL_TRUTH.md`
- Sprint scope + deliverables: `docs/WORKFLOW_HARDENING_SPRINT.md`
- Proof / engineering evidence: `docs/VERIFICATION_EVIDENCE.md` + `proof/*` reports

Guardrail: do not publish posts, send messages, or invite members without explicit action-time confirmation.

## Current Signal Snapshot (operator-reported; not commercial proof)

- 30d visitors: 6169
- Checkout starts: 133
- Paid orders: 4
- Booked: `$149`
- Signups: 475
- Sprint leads: 0

## Offer Routing (fast rules)

1. **Sprint** when: one workflow owner + repeated failure + rollout/approval risk + they want proof.
2. **Diagnostic** when: pain is real but scope is unclear; earn the right to sprint.
3. **Pro** when: self-serve install intent or “I just want the tool / dashboard / exports”.

Never claim ROI. Always anchor to “one repeated mistake → one prevention rule → one proof run”.

## Close Scripts (copy blocks)

### 1) First-touch (Sprint)

“If you have one repeated failure in one AI-agent workflow, I can harden it end-to-end this week: map the workflow, turn the repeated failure into an enforceable Pre-Action Gate, and produce a proof pack you can defend to your team. Worth a 15-minute diagnostic?”

CTA: `https://thumbgate-production.up.railway.app/#workflow-sprint-intake`

### 2) Diagnostic close ($499)

“If you’re not sure yet whether this is a Sprint or just wiring + guardrails, we can do the Workflow Hardening Diagnostic first. You’ll leave with the workflow map, failure pattern, and the exact gate + proof plan. If it’s a fit, the Sprint is the immediate next step.”

Use the `$499` diagnostic checkout link from `docs/COMMERCIAL_TRUTH.md` / sprint docs (do not improvise links).

### 3) Sprint close ($1500)

“You’ll get: (1) workflow map + approval boundaries, (2) the prevention gate wired into your agent loop, (3) proof artifacts that show the repeated failure stopped repeating. Sprint is `$1500` for one workflow.”

Use the `$1500` sprint checkout link from `docs/COMMERCIAL_TRUTH.md` / sprint docs (do not improvise links).

### 4) Pro close ($19/mo or $149/yr)

“If you want to evaluate self-serve first, start with the setup guide. If one mistake keeps repeating, Pro is the clean next step for evidence + exports.”

- Guide: `https://thumbgate-production.up.railway.app/guide`
- Pro checkout: `https://thumbgate-production.up.railway.app/checkout/pro`

## Proof Packet (only after pain is confirmed)

- Commercial truth: `docs/COMMERCIAL_TRUTH.md`
- Verification evidence: `docs/VERIFICATION_EVIDENCE.md`
- Proof reports: `proof/compatibility/report.json` and `proof/automation/report.json`

## Next Money Actions (no auto-send)

1. Send the 4 warm Sprint DMs in `reports/gtm/2026-05-04-money-now/operator-send-now.md`.
2. After each send, log the stage movement using `npm run sales:pipeline -- advance ...` (commands are in the send sheet).
3. When anyone replies with pain, reply with the Diagnostic or Sprint close copy above (then attach proof packet).

