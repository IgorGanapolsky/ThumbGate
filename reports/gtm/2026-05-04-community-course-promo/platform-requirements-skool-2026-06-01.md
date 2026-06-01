# Platform Requirements — Skool (2026-06-01)

Status: verified enough to execute (official links captured; remaining unknowns are non-blocking).

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
- Discovery listing threshold checklist (what blocks UNLISTED):
  - https://help.skool.com/article/151-why-isnt-my-group-visible-in-discovery
- About page setup:
  - https://help.skool.com/article/123-how-to-set-up-my-group-s-about-page
- Pinning posts:
  - https://help.skool.com/article/38-how-do-to-pin-a-post
- Adding videos (native upload + embeds):
  - https://help.skool.com/article/58-video
- Classroom video troubleshooting (hosting partners):
  - https://help.skool.com/article/178-how-to-troubleshoot-video-issues
- Traffic attribution notes (use About page link directly):
  - https://help.skool.com/article/226-traffic-sources

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
- Discovery listing checklist (for new groups):
  - Minimum threshold checklist includes: cover image, group description, complete About page, write a post, and invite members.
- Pinned posts:
  - Skool supports pinning posts to the feed and also pinning posts to course pages.
  - Official limits:
    - Admins can pin up to `3` posts to the community feed.
    - You can pin up to `12` posts per course page, and a post can be pinned to the feed and a page at the same time.
- Cover + icon size guidance (Skool UI labels them as “Recommended” in Settings → General):
  - Icon: `128 x 128`
  - Cover: `1084 x 576`
- Text limits (observed in Skool UI counters):
  - Group name: `30` chars
  - Group description (Settings → General): `150` chars
  - About page description: `1000` chars
- Classroom video:
  - Skool supports native video uploads into Classroom pages, and members can upload videos to community posts/comments.
  - Skool also supports embedding videos hosted on YouTube, Vimeo, Wistia, and Loom.
  - Operational default (given local picker/upload blockers): use a supported external video host and embed into Classroom rather than depending on direct-file upload.
- Traffic sources:
  - For optimal tracking accuracy, use your About page link directly (avoid redirects / link-in-bio shorteners when you want clean Skool attribution).

## Still unknown (non-blocking)

- Discovery keywords:
  - No official help-center constraints found yet for max keywords, weighting, or edit frequency limits.
- Cover/icon file type constraints:
  - We have “Recommended” pixel sizes from Skool’s UI, but we still do not have a help-center page that states supported image file types and any filesize limits.
- About page media slots:
  - Help-center docs mention uploading images/videos, but do not state the maximum number of media tiles in the About section.

## Verification TODO (when web access is available)

- Record official Skool help-center links for:
  - cover/icon supported file types + filesize limits
  - video limits (duration, size, codecs, aspect ratios) if direct upload exists
  - About media slot limits (max images/videos)
  - discoverability settings and keyword behavior
  - pinned post behavior and any ranking limitations
