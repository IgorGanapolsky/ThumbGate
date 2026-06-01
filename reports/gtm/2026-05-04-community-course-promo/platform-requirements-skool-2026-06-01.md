# Platform Requirements — Skool (2026-06-01)

Status: partially verified (official links captured; some specs still unverified).

Purpose: keep one place to track Skool surface requirements we must satisfy for Operator Lab visibility and conversion (cover/icon sizes, video formats, About text constraints, discovery keywords, pinned post behavior).

Guardrail: do not publish posts, send messages, invite members, upload files, create accounts, change billing, submit forms, or run paid ads without explicit action-time confirmation.

## Known surfaces we use

- Group cover image (Operator Lab)
- Group icon
- About text
- Discovery keywords
- Pinned “Start Here” post
- Optional: intro/explainer video

## Official Skool references (verified links)

- Public vs private groups:
  - https://help.skool.com/article/122-how-to-toggle-between-private-and-public
- Discovery eligibility + basic requirements:
  - https://help.skool.com/article/153-discovery-faqs
- Pinning posts:
  - https://help.skool.com/article/38-how-do-to-pin-a-post
- Adding videos (native upload + embeds):
  - https://help.skool.com/article/58-video
- Classroom video troubleshooting (hosting partners):
  - https://help.skool.com/article/178-how-to-troubleshoot-video-issues

## Current local asset reality (this checkout)

- Present:
  - `docs/marketing/assets/thumbgate-skool-cover-1084x576.png`
  - `docs/marketing/assets/thumbgate-skool-icon-128x128.png`
  - `docs/marketing/assets/thumbgate-operator-lab-about-hero.png`
  - `docs/marketing/assets/thumbgate-operator-lab-social-landscape.png`
  - `docs/marketing/assets/thumbgate-operator-lab-social-square.png`
  - `docs/marketing/assets/thumbgate-operator-lab-social-story.png`
- Not present in this repo checkout (may exist locally but untracked / not committed):
  - `docs/marketing/assets/thumbgate-operator-lab-explainer.mp4`
  - `docs/marketing/assets/thumbgate-operator-lab-explainer-vertical.mp4`

## What we can say with confidence today (from official help docs)

- Public vs private:
  - Public groups expose members + posts publicly and are searchable in Discovery.
  - Private groups require joining to see posts, but are still searchable in Discovery (per Skool’s wording).
- Discovery basics:
  - Discovery eligibility depends on meeting Skool’s Discovery requirements (see official Discovery FAQ).
- Pinned posts:
  - Skool supports pinning posts to the feed and also pinning posts to course pages.
  - Official limits:
    - Admins can pin up to `3` posts to the community feed.
    - You can pin up to `12` posts per course page, and a post can be pinned to the feed and a page at the same time.
- Classroom video:
  - Skool supports native video uploads into Classroom pages, and members can upload videos to community posts/comments.
  - Skool also supports embedding videos hosted on YouTube, Vimeo, Wistia, and Loom.
  - Operational default (given local picker/upload blockers): use a supported external video host and embed into Classroom rather than depending on direct-file upload.

## Unverified specs (need direct Skool confirmation)

- Cover image:
  - Working community standard we use: `1084 x 576` (PNG).
  - Still need an official Skool help-center link for exact dimensions and supported file types.
- Group icon:
  - Working community standard we use: `128 x 128` (PNG).
  - Still need an official Skool help-center link for exact dimensions and supported file types.
- About text:
  - Need official constraints: max length, link behavior, and whether images/embeds are allowed.
- Discovery keywords:
  - Need official constraints: max keywords, weighting, and edit frequency limits (if any).
- Pinned post behavior:
  - Need official constraints: whether pinning differs for public vs private, and whether pins impact Discovery ranking.

## Verification TODO (when web access is available)

- Record official Skool help-center links for:
  - cover image dimensions + file types
  - profile/group icon dimensions + file types
  - video limits (duration, size, codecs, aspect ratios) if direct upload exists
  - About text constraints (length, links)
  - discoverability settings and keyword behavior
  - pinned post behavior and any ranking limitations
