# Zero-Filming IG + TikTok Automation

This is the local-first social pipeline for ThumbGate.

It exists so we can ship founder-style IG and TikTok content without filming, manual screenshotting, or manual posting.

## What The Pipeline Does

1. Renders a repo-owned HTML carousel into `1080x1080` PNG slides.
2. Builds a TikTok-safe `1080x1920` MP4 fallback from those same slides.
3. Validates that the rendered bundle contains exactly `5` non-empty `1080x1080` PNG slides and records SHA-256 hashes in the bundle manifest.
4. Writes a bundle manifest with canonical asset paths, caption paths, and proof-friendly asset metadata.
5. Queues timed posts under local runtime state in `.thumbgate/social-post-queue.json`.
6. Blocks duplicate live publishes via `.thumbgate/social-post-history.jsonl` unless `--force` is supplied.
7. Publishes through the already-authenticated Chrome session for Instagram and TikTok.

## Ralph Mode CI

Ralph Mode is the always-on acquisition loop for audience engagement. Two GitHub Actions workflows
share the lane:

- `.github/workflows/ralph-mode.yml` runs every two hours for outbound campaign posts, GitHub issue
  monitoring, repo discovery, and dev.to outreach through `scripts/ralph-mode-ci.js`. It restores
  and saves `.thumbgate/ralph-state.json` so CI does not re-contact the same audience.
- `.github/workflows/ralph-loop.yml` runs hourly for audience sensing, reply monitoring, analytics
  polling, launch asset sync, and machine-readable evidence from `scripts/ralph-loop.js`.

The guardrails are intentional:

- Reddit stays draft-only. Suggested replies go to `.thumbgate/reply-drafts.jsonl`.
- X replies pass the contextual social quality gate before posting.
- LinkedIn comment intake remains limited until the required API approval is available.
- Ralph Mode outbound state and Ralph Loop reply state are cache-backed so CI does not spam the audience.
- Ralph reports link back to [VERIFICATION_EVIDENCE.md](../VERIFICATION_EVIDENCE.md) for authority evidence.

Run the same loop locally:

```bash
node scripts/ralph-loop.js --mode=all --dry-run
```

Manual CI modes are `all`, `engage`, `poll`, `audit`, and `post`. The scheduled hourly mode uses
`all`, which senses, engages, and audits without invoking the manual-post lane.

## Canonical Source

- Carousel HTML: [assets/pre-action-checks-instagram-carousel.html](./assets/pre-action-checks-instagram-carousel.html)
- Caption: [assets/pre-action-checks-caption.txt](./assets/pre-action-checks-caption.txt)

## Prerequisites

- macOS
- Google Chrome with the target IG/TikTok accounts already logged in
- `View -> Developer -> Allow JavaScript from Apple Events` enabled in Chrome
- `ffmpeg` installed and available on `PATH`

## Commands

Prepare a bundle:

```bash
npm run social:prepare -- --slug pre-action-checks
```

One-command prepare + publish with the default dual-platform lane:

```bash
npm run social:post -- \
  --source /Users/ganapolsky_i/Downloads/instagram-carousel-slides.html \
  --caption-text "Every AI memory tool asks the agent to cooperate. Pre-Action Checks don't ask - they enforce." \
  --backend playwright \
  --profile-dir Default \
  --slug first-live-social-post
```

Prepare from a custom HTML file and inline caption:

```bash
npm run social:prepare -- \
  --source /Users/ganapolsky_i/Downloads/instagram-carousel-slides.html \
  --caption-text "Every AI memory tool asks the agent to cooperate. Pre-Action Checks don't ask - they enforce." \
  --slug pre-action-checks-session
```

Queue the prepared bundle:

```bash
npm run social:queue -- \
  --bundle .artifacts/social/pre-action-checks/bundle.json \
  --when 2026-03-23T09:00:00-04:00 \
  --platforms instagram,tiktok
```

Re-running the same queue command for the same bundle, schedule, and platforms reuses the existing pending entry instead of creating a duplicate post.

Inspect queue state:

```bash
npm run social:status
```

Prepare browser drafts without publishing:

```bash
npm run social:publish -- \
  --bundle .artifacts/social/pre-action-checks/bundle.json \
  --platforms instagram,tiktok \
  --no-share \
  --cleanup-drafts
```

Publish immediately:

```bash
npm run social:publish -- \
  --bundle .artifacts/social/pre-action-checks/bundle.json \
  --platforms instagram,tiktok
```

If the same platform/caption/slide-hash combination was already published, the command exits with a duplicate-protection error. Use `--force` only when you intentionally want to repost the same content:

```bash
npm run social:publish -- \
  --bundle .artifacts/social/pre-action-checks/bundle.json \
  --platforms instagram,tiktok \
  --force
```

Publish all due queue entries:

```bash
npm run social:publish:queue
```

Install a `launchd` scheduler that checks the queue every 15 minutes:

```bash
npm run social:scheduler:install
```

Preview the generated `launchd` file without installing it:

```bash
npm run social:scheduler:install -- --dry-run
```

## Runtime Notes

- Instagram uses the same 5-slide carousel bundle directly.
- TikTok publish now prefers a same-slide photo carousel when the live web surface exposes image uploads. On the current account surface, TikTok Studio exposes a `video/*` uploader, so the pipeline falls back to the generated MP4 truthfully and automatically.
- Queue state lives under `.thumbgate/` and is intentionally local-only.
- Publish history also lives under `.thumbgate/` and is intentionally local-only.
- The pipeline supports `--dry-run` and `--no-share` so browser automation can be verified without pushing duplicate live posts.
- The currently verified backend in this worktree is the copied-profile Playwright lane (`--backend playwright`), not AppleScript.
- March 21, 2026 proof from this branch:
  - `.artifacts/social/live-combined-preflight-proof-20260321c/` contains a deterministic 5-slide bundle sourced from `/Users/ganapolsky_i/Downloads/instagram-carousel-slides.html`.
  - `social:publish --platforms instagram --no-share --cleanup-drafts --backend playwright --profile-dir Default` returned `draft-ready` with `assetCount: 5`.
  - The corresponding attempt directory is `.artifacts/social/live-combined-preflight-proof-20260321c/publish-attempts/instagram-1774117555400-pccxyr/`.
  - The combined dual-platform lane halted before a partial publish with `TikTok did not reach an authenticated upload surface: {"error":"Timed out waiting for browser state on https://www.tiktok.com/tiktokstudio/"}`.
- No actual TikTok post was published from this branch because the available Chrome profiles do not contain an authenticated TikTok session.
- Install the `launchd` agent only from a durable checkout path you intend to keep, because the plist points at the repo path that installed it.
