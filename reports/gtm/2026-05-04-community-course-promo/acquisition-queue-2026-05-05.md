# Acquisition Queue (Operator Lab + Sprint)

Updated: 2026-05-05

Guardrail: do not publish posts, send messages, invite members, upload files, create accounts, change billing, submit forms, or run paid ads without explicit action-time confirmation.

Goal: turn high-intent operators into one of:

- Workflow Hardening Diagnostic (`$499`)
- Workflow Hardening Sprint (`$1500`)
- Pro (`$19/mo` or `$149/yr`)

Offer routing truth table: `reports/gtm/2026-05-04-money-now/revenue-close-room.md`

## Lane A: Money now (warm DMs) — highest ROI

Canonical send queue + logging commands:

- `reports/gtm/2026-05-04-money-now/operator-send-now.md`
- `reports/gtm/2026-05-04-money-now/sales-pipeline.md`

Approval-ready steps (no auto-send):

1. Send the first 4 warm Sprint DMs (the Reddit rows at the top of `operator-send-now.md`).
2. After each send, run that row’s `Log after send` command.
3. Only after pain is confirmed, reply with Diagnostic/Sprint close copy and include proof links.

## Lane B: Skool Discovery eligibility (unblocker)

Skool Discovery requires (Skool official help, verified 2026-05-05):

- Cover image
- Group description
- Completed About page (description + images/videos)
- At least one post
- Inviting members

Source:

- https://help.skool.com/article/151-why-isnt-my-group-visible-in-discovery
- https://help.skool.com/article/123-how-to-set-up-my-group-s-about-page

Approval-ready steps (no uploads here):

1. Upload cover + icon (use a normal browser if the in-app file picker blocks uploads).
   - Cover: `docs/marketing/assets/thumbgate-skool-cover-1084x576.png`
   - Icon: `docs/marketing/assets/thumbgate-skool-icon-128x128.png`
2. Paste About copy and save: `reports/gtm/2026-05-04-community-course-promo/skool-about-copy.md`.
3. Publish + pin the “Start Here” post from the same file.
4. Invite the first 10–20 warm contacts.

## Lane C: Public posting (lead-gen → Skool)

Posting objective: recruit operators to post one repeated mistake in Skool (top-of-funnel), then route to Diagnostic/Sprint only when pain is confirmed.

Draft angles (pick one per post; keep it narrow):

1. Pre-Action Gates: block one repeated tool misuse before it happens.
2. Workflow hardening: one workflow, one owner, one proof review.
3. Proof pack: before/after behavior + verification evidence (no ROI claims).
4. Thompson Sampling for lessons: reduce repeated agent mistakes without brittle prompt hacks.

CTA (Skool-first):

- Skool: `https://www.skool.com/thumbgate-operator-lab-6000`
- Prompt: “Post one repeated agent mistake using the template.”

Paid CTA (only after pain is confirmed):

- Intake: `https://thumbgate-production.up.railway.app/#workflow-sprint-intake`
