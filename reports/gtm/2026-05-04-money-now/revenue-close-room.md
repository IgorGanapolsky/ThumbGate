# Revenue Close Room (Money Now)

Updated: 2026-06-11T15:42:13Z

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
- Live pipeline state re-verified at `2026-06-11T15:42:13Z`: `24` active leads, `22` contacted, `2` replied, `0` paid
- Current loop constraints on 2026-06-11:
  - local Operator Lab promo preview still runs cleanly, but it is not healthy as a media-backed path in this checkout
  - local preview still shows `accountCount: 0` across platforms in this runtime, so live promo should stay on the GitHub Actions path with secrets
  - local shell still has no `ZERNIO_API_KEY` loaded as of `2026-06-11T15:42:13Z`, so local runs should remain preview-only for media-backed publishing
  - Zernio analytics re-check at `2026-06-11T15:41:45Z` is still dark (`0/6` healthy platforms, `0` rows in the last `24h`)
  - Skool readback remains blocked in the headless runtime, so live public-page claims still need browser-authenticated verification
  - `.github/workflows/thumbgate-creator-platform-promo.yml` still defaults to `--offer=operator-lab`
  - official Skool help still supports the current value-first free-group posture: Discovery FAQ updated `April 8, 2026` and now flags upcoming `Q2 2026` algorithm changes; pricing updated `October 28, 2025`, About page updated `December 9, 2025`, Analytics definitions updated `November 24, 2025`, Payments FAQ updated `April 22, 2026`, and payouts setup updated `January 22, 2026`
  - the current checkout does not contain `docs/marketing/assets/`, so the local promo preview is copy-only until those asset files are restored
  - refreshed platform brief now lives in `reports/gtm/2026-05-04-community-course-promo/skool-platform-requirements-2026-06-11.md`

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

1. Send the 4 contacted warm Reddit follow-ups first from `reports/gtm/2026-05-04-money-now/operator-send-now.md`.
2. There is no untouched Pro batch left in the latest-per-lead pipeline state; wait for reply movement or create a new ranked batch before sending colder outreach.
3. After each send, log the stage movement using `npm run sales:pipeline -- advance ...` (commands are in the send sheet).
4. If a warm lead confirms pain but scope is unclear, use the Diagnostic close first.
5. If the lead already has one workflow owner plus one repeated failure blocking rollout, use the Sprint close.
