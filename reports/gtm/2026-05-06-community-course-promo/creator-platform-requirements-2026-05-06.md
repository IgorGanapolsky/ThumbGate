# Creator Platform Requirements (refreshed 2026-05-06)

Guardrail: do not publish posts, send messages, invite members, upload files, create accounts, change billing, submit forms, or run paid ads without explicit action-time confirmation.

Purpose: keep media-backed Operator Lab promos compliant across the platforms configured in `.github/workflows/thumbgate-creator-platform-promo.yml`.

## Platforms in scope (workflow default)

Workflow input default:

- `linkedin,instagram,threads,bluesky,reddit,youtube`

## Official specs / docs (best-effort)

Note: some platforms do not provide a single canonical “media specs” help page. When no official spec page is found quickly, treat items below as *operational defaults* and re-check in-app before publishing.

### LinkedIn

Official references:

- Share photos on LinkedIn: https://www.linkedin.com/help/linkedin/answer/a527229
- Image specifications for LinkedIn Pages/Career Pages: https://www.linkedin.com/help/linkedin/answer/a563309/image-specifications-for-your-linkedin-pages-and-career-pages

Operational defaults (safe):

- Prefer `1:1` (square) or `1.91:1` (landscape) images.
- Avoid “link + image” in the same post (LinkedIn typically forces one or the other).

### YouTube (Shorts)

Official references:

- Upload YouTube Shorts (Computer): https://support.google.com/youtube/answer/12779649
- Understand three-minute YouTube Shorts: https://support.google.com/youtube/answer/15424877

Operational defaults (safe):

- Vertical or square aspect ratio.
- Duration `<= 3 minutes` to classify as Shorts (see official docs above).

### Reddit

Official references (closest-canonical for upload constraints):

- Video in comments specs (length + file size): https://support.reddithelp.com/hc/en-us/articles/48109333836692-How-do-I-add-video-in-comments

Operational defaults (safe):

- Keep video `<= 3 minutes` and `<= 1 GB` (Reddit help cites this for comment video uploads; post uploads can vary by surface/community).
- Expect community-level restrictions (karma/age) and media availability differences across subreddits.

### Instagram / Threads / Bluesky

As-of 2026-05-06, this repo’s workflow assumes standard creator defaults:

- **Instagram:** prioritize vertical `9:16` (Reels/Stories) and `1:1` (feed square).
- **Threads:** prioritize square `1:1` and portrait `4:5` images; short vertical video.
- **Bluesky:** keep videos short (commonly `<= 3 minutes`) and keep image/file sizes small (Bluesky clients may recompress).

Re-check in-app limits before publishing.

## ThumbGate Operator Lab media pack (repo truth)

These are the assets the Skool/About + promo workflow references.

### Skool branding

- Cover: `docs/marketing/assets/thumbgate-skool-cover-1084x576.png` (`1084x576`, ~`1.88:1`)
- Icon: `docs/marketing/assets/thumbgate-skool-icon-128x128.png` (`128x128`, `1:1`)

### About + promo visuals

Images:

- Hero: `docs/marketing/assets/thumbgate-operator-lab-about-hero.png` (`1600x900`, `16:9`)
- Social landscape: `docs/marketing/assets/thumbgate-operator-lab-social-landscape.png` (`1600x900`, `16:9`)
- Social square: `docs/marketing/assets/thumbgate-operator-lab-social-square.png` (`1080x1080`, `1:1`)
- Social story: `docs/marketing/assets/thumbgate-operator-lab-social-story.png` (`1080x1920`, `9:16`)

Videos:

- Explainer (landscape): `docs/marketing/assets/thumbgate-operator-lab-explainer.mp4` (`1600x900`, ~`10s`, `h264`)
- Explainer (vertical): `docs/marketing/assets/thumbgate-operator-lab-explainer-vertical.mp4` (`1080x1920`, ~`10s`, `h264`)

