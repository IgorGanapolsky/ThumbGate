# Implementation Notes — Ralph Loop Community Course Growth

Date: 2026-06-06
Run started: 2026-06-06T17:18:01Z

## Decisions

- Use the latest event per `leadId` in `.thumbgate/sales-pipeline.jsonl` as the revenue truth source, not raw row counts.
  - Why: the ledger is append-only and raw counts double-count old stages.
- Keep the next money motion pinned to the four warm Reddit follow-ups.
  - Why: they are still the highest-intent live rows, and there are no untouched Pro leads left in the latest-per-lead state.
- Refresh Skool platform requirements from official help-center sources and preserve the value-first free-group posture.
  - Why: Discovery still penalizes off-platform payments, so public Skool surfaces should not lead with paid links.

## Assumptions

- VERIFIED: `npm run sales:pipeline -- summary` reports `24` active leads, `22` contacted, `2` replied, `0` paid on 2026-06-06.
- VERIFIED: collapsing `.thumbgate/sales-pipeline.jsonl` by latest `leadId` event yields the same `24 / 22 / 2 / 0` truth.
- VERIFIED: `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube` still returns `6` previews with all media assets present on 2026-06-06.
- VERIFIED: `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h` on 2026-06-06.
- VERIFIED: `.github/workflows/thumbgate-creator-platform-promo.yml` still defaults `offer` to `operator-lab`.
- VERIFIED: `gh pr list --state open --limit 5` now shows `#2550`, `#2541`, `#2540`, `#2511`, and `#2503` at `2026-06-06T18:17:40Z`, confirming the previous PR snapshot in the handoff docs had gone stale.
- VERIFIED: `npm run sales:pipeline -- summary` still reports a misleading top-level `contacted: 24`, while the latest-event-per-lead stage truth remains `22 contacted` and `2 replied`.
- VERIFIED: official Skool help still supports the current free-group posture on 2026-06-06, including Discovery FAQ last updated `April 8, 2026`, About page `December 9, 2025`, pricing `October 28, 2025`, payouts `January 22, 2026`, payout status `May 5, 2026`, analytics definitions `November 24, 2025`, and membership questions max `3` with `1` email field.
- VERIFIED: Skool help-center search results still show Discovery FAQ updated April 8, 2026; pricing updated October 28, 2025; About page updated December 9, 2025; analytics definitions updated November 24, 2025; Payments FAQ updated April 22, 2026; payouts setup updated January 22, 2026.
- UNVERIFIED: the live public Skool About page, artwork, and Growth tab still require browser-authenticated readback because headless fetch remains blocked.

## Corrections

- Corrected the stale assumption that two untouched Pro leads were still waiting. The latest-per-lead pipeline state shows both `github_easingthemes_dx_aem_flow` and `github_zaxbysauce_opencode_swarm` are already `contacted`.
- Corrected the stale requirement-file references. The previously referenced `skool-platform-requirements-2026-06-06.md` and `next-actions-2026-06-06.md` were missing in the worktree and needed to be recreated or replaced with current files.
- Corrected the stale open-PR snapshot and warm-DM batch label in the community-course handoff docs after re-verifying `gh pr list` and the current revenue queue.
- Corrected the residual contradiction inside the money-action docs where the GitHub self-serve rows were still labeled "send now" despite already being contacted on 2026-06-05.

## Tradeoffs

- I updated the operator GTM docs instead of trying to repair Skool readback automation in this run.
  - Reason: the immediate ROI gap is stale sales guidance, not another blocked headless Skool fetch path.
- I did not trigger any live GitHub Actions promo publish.
  - Reason: the run guardrails require action-time confirmation for publishing, and the local shell still lacks `ZERNIO_API_KEY`.

## Async Review Notes

- The highest-signal change is the queue correction: there is no A2 untouched-Pro batch anymore.
- The next approval-ready action is now a single A1: send the four warm Reddit follow-ups, then wait for stage movement before creating a new send batch.
- The pipeline-summary command remains useful for total lead count, but not for the actionable contacted mix; keep using the latest-per-lead collapse for operator docs.
