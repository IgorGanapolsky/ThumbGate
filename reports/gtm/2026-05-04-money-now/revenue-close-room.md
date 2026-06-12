# Revenue Close Room (Money Now)

Updated: 2026-06-12T18:05:34Z

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
- Live pipeline state re-verified at `2026-06-12T18:05:34Z` via `node scripts/sales-pipeline.js`: `24` active leads, `22` in `byStage.contacted`, `2` in `replied`, `0` paid
- Current loop constraints on 2026-06-12:
  - local Operator Lab promo preview still runs cleanly in this run at `2026-06-12T18:05:34Z`, but it is not healthy as a media-backed path in this checkout
  - local preview still shows `accountCount: 0` across platforms in this runtime, so live promo should stay on the GitHub Actions path with secrets
  - local shell still has no `ZERNIO_API_KEY` loaded in this runtime, so local runs should remain preview-only for media-backed publishing
  - `npm run social:zernio:status` at `2026-06-12T18:05:22.035Z` still reports `0/6` healthy platforms and `0` rows in the last `24h`, so social analytics remain dark in this runtime
  - public Skool readback still reports `Members: 1` with `0` visible posts in this run at `2026-06-12T18:05:34Z`
  - public search visibility re-verified this run includes the live Skool page plus the YouTube Short `https://www.youtube.com/shorts/vl1cuPogSHg`, but there is still no evidence that those surfaces are converting into Skool member/post density
  - `.github/workflows/thumbgate-creator-platform-promo.yml` still defaults to `--offer=operator-lab`
  - official Skool help still supports the current value-first free-group posture: Discovery FAQ updated `April 8, 2026` and now flags upcoming `Q2 2026` algorithm changes; About page updated `December 9, 2025`, publish-a-course updated `March 13, 2025`, course permissions updated `November 10, 2025`, Classroom updated `May 29, 2026`, AutoMod updated `April 2, 2026`, Meta pixel tracking updated `May 29, 2026`, Payments FAQ updated `April 22, 2026`, and payout status updated `May 5, 2026`
  - the current checkout does not contain `docs/marketing/assets/`, and a repo-wide asset filename search in this run found no staged Operator Lab media files anywhere in the checkout, so the local promo preview is copy-only until those asset files are restored
  - refreshed platform brief now lives in `reports/gtm/2026-05-04-community-course-promo/skool-platform-requirements-2026-06-12.md`
  - refreshed community next-actions brief now lives in `reports/gtm/2026-05-04-community-course-promo/next-actions-2026-06-12.md`
  - refreshed community growth readback now lives in `reports/gtm/2026-05-04-community-course-promo/community-growth-readback-2026-06-12.md`
  - first public-post draft now lives in `reports/gtm/2026-05-04-community-course-promo/skool-public-post-draft-2026-06-11.md`

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
6. If outbound is not approved, the only community-side action worth approving next is the first copy-only Skool seed post; do not substitute a colder lead batch.
