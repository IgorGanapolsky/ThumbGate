# Revenue Close Room (Money Now)

Updated: 2026-06-06T13:11:16Z

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
- Live pipeline state re-verified in this run: `24` active leads, `22` stage-count `contacted`, `2` replied, `24` aggregate contacted, `0` targeted, `0` paid
- Current loop constraints on 2026-06-06:
  - local Operator Lab promo preview is healthy in this run
  - local preview still shows `accountCount: 0` across platforms in this runtime, so live promo should stay on the GitHub Actions path with secrets
  - local shell still has no `ZERNIO_API_KEY` loaded in this run, so local runs should remain preview-only for media-backed publishing
  - Zernio analytics re-check is still dark (`0/6` healthy platforms, `0` rows in the last `24h`; generated `2026-06-06T13:11:16.606Z`)
  - the canonical local Operator Lab preview command remains `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`; the older `creator:platform:promo` alias is not present in this checkout
  - Skool readback re-check is still blocked in the headless runtime with `[skool-reader] fetch failed`
  - the latest direct GitHub probe failed again with `error connecting to api.github.com`, so fresh PR/CI readback is unavailable from this shell right now
  - the last trustworthy GitHub snapshot in this shell shows open PRs `#2511`, `#2509`, `#2503`, `#2464`, `#2463`, `#2461`, `#2445`, `#2444`, `#2439`, and `#2438`, with recent `main` deploy/verify workflow rows through `2026-06-06T06:43:02Z` completed successfully
  - official Skool help still supports the current value-first free-group posture: Discovery FAQ updated `April 8, 2026`, discovery checklist updated `April 15, 2026`, About page setup updated `December 9, 2025`, Classroom updated `May 29, 2026`, course publishing updated `March 13, 2025`, course permissions updated `November 10, 2025`, membership questions updated `September 19, 2025`, pricing models updated `October 28, 2025`, video guidance updated `February 12, 2026`, Analytics definitions updated `November 24, 2025`, Traffic Sources updated `February 17, 2026`, Payments FAQ updated `April 22, 2026`, and payout-status guidance updated `May 5, 2026`

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
2. Use the 2 already-contacted Pro leads as close-follow-ups second after the warm Reddit batch is approved/sent.
3. After each send, log the stage movement using `npm run sales:pipeline -- advance ...` (commands are in the send sheet).
4. If a warm lead confirms pain but scope is unclear, use the Diagnostic close first.
5. If the lead already has one workflow owner plus one repeated failure blocking rollout, use the Sprint close.
