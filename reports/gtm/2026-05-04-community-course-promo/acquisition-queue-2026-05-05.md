# Acquisition Queue (Operator Lab + Sprint)

Updated: 2026-06-06T03:09:35Z

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
4. Send the 2 already-contacted GitHub Pro close-follow-ups only after the warm Reddit batch is approved/sent.

Current verified queue on 2026-06-06:

- Live pipeline: `24` active leads, `24` contacted, `2` replied, `0` targeted, `0` paid
- A1 first: `reddit_deep_ad1959_r_cursor`, `reddit_game_of_kton_r_cursor`, `reddit_leogodin217_r_claudecode`, `reddit_enthu_cutlet_1337_r_claudecode`
- A2 second: `github_easingthemes_dx_aem_flow`, `github_zaxbysauce_opencode_swarm`
- Re-verified priority in this run: keep A1 first; no current Skool/platform task has higher expected revenue than working the four warm Reddit follow-ups.

## Lane B: Skool Discovery eligibility (unblocker)

Skool Discovery requires (Skool official help, re-verified 2026-06-06):

- Cover image
- Group description
- Completed About page (description + images/videos)
- At least one post
- Inviting members
- Discovery FAQ visibility timing: within `2` hours once the threshold is met
- Discovery ranking penalty to keep in mind: `off-platform payments`

Source:

- https://help.skool.com/article/151-why-isnt-my-group-visible-in-discovery
- https://help.skool.com/article/123-how-to-set-up-my-group-s-about-page
- https://help.skool.com/article/153-discovery-faqs

Approval-ready steps (no uploads here):

1. Upload cover + icon (use a normal browser if the in-app file picker blocks uploads).
   - Cover: `docs/marketing/assets/thumbgate-skool-cover-1084x576.png`
   - Icon: `docs/marketing/assets/thumbgate-skool-icon-128x128.png`
2. Paste About copy and save: `reports/gtm/2026-05-04-community-course-promo/skool-about-copy.md`.
3. Publish + pin the “Start Here” post from the same file.
4. Invite the first 10–20 warm contacts.
5. Keep the public Skool surface value-first; do not lead with off-platform paid links on the public page.

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

Current workflow readiness on 2026-06-06:

- Local `--offer=operator-lab` preview re-ran successfully at `2026-06-06T02:08:06Z` and still returns `6` previews.
- Every referenced media asset still exists locally.
- Preview-mode `accountCount` is still `0` on every platform in this runtime, so live publish/schedule should stay on the GitHub Actions path with secrets.
- Local shell still has no `ZERNIO_API_KEY` at `2026-06-06T02:08:06Z`, so do not treat this runtime as publish-ready.

## Lane D: Public market signals (Skool-first positioning)

Public-page benchmark refresh from `2026-06-05` public Skool/search readback:

- Free/operator education still dominates the strongest visible AI-adjacent Skool groups that surfaced in public search.
- `AI Operations Lab` surfaced as `Free` with `722` members.
- `AI OPERATORS HQ` surfaced as `Free` with `41` members.
- `AI Operator Club` surfaced as `Free` with `40` members.
- Higher-ticket positioning exists, but price only works once the niche and outcome are already obvious:
  - `AI Operator Academy` surfaced at `$999/year` with `35` members.
- Smaller free operator groups also exist, which reinforces the value-first public posture:
  - `AI Operator` surfaced as `Free` with `13` members.

Implication for ThumbGate:

1. Keep Operator Lab free and outcome-first on the public surface.
2. Use the Skool CTA to collect repeated-failure posts, not to force immediate checkout intent.
3. Route paid intent into Diagnostic, Sprint, or Pro only after pain is confirmed in comments, DMs, or direct follow-up.
4. Do not spend another cycle polishing Skool before the warm four-pack and the two Pro close-follow-ups are worked.
