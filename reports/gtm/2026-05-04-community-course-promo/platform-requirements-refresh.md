# Platform Requirements Refresh — Skool + Course Surfaces

Updated: 2026-05-05

Goal: keep ThumbGate Operator Lab compliant with current Skool discovery requirements and keep the “Workflow Hardening” offer copy aligned with `docs/COMMERCIAL_TRUTH.md`.

This file is a refresh checklist. It is intentionally written so it can be completed in 10–15 minutes once you have browser access.

## Source of truth (Skool Help Center)

- Discovery FAQs (Last updated: 2026-04-08): https://help.skool.com/article/153-discovery-faqs
- Why isn’t my group visible on Discovery? (Published: ~2026-04): https://help.skool.com/article/151-why-isnt-my-group-visible-in-discovery
- How to set up my group’s About page? (Last updated: 2025-12-09): https://help.skool.com/article/123-how-to-set-up-my-group-s-about-page
- How to set up my group logo and cover photo? (Last updated: 2025-06-18): https://help.skool.com/article/120-how-to-set-up-my-group-logo-and-cover-photo
- How to pin a post? (Last updated: 2025-03-03): https://help.skool.com/article/38-how-do-to-pin-a-post
- What is Classroom? (Published: ~2026-01): https://help.skool.com/article/166-what-is-classroom
- How to add videos (Last updated: 2026-02-12): https://help.skool.com/article/58-video
- How to setup pricing for the group? (Published: ~2025-11): https://help.skool.com/article/215-how-to-setup-pricing-for-the-group

## Skool discovery / setup (verify in Skool UI)

Minimum threshold (per Skool Help Center, summary):
- cover image set
- group description filled
- About page completed
- at least 1 post written
- members invited

- [ ] Cover image uploaded
- [ ] Icon uploaded
- [ ] About media uploaded (optional, but discovery-boosting)
- [ ] Group description is filled (sidebar)
- [ ] About page description is filled (and at least 1 image if possible)
- [ ] At least 1 public post published (discovery threshold requirement)
- [ ] “Start Here” post published + pinned
- [ ] Categories created (<= 10) and consistent with Operator Lab
- [ ] Classroom has at least 1 course (draft is fine, but must be truthful)
- [ ] Invite policy followed (manual invites only; no spam blasts)
- [ ] Discovery eligibility check: Settings → Discovery shows Listed/Unlisted, category, and language

### Discovery rank levers (from Skool Help Center)

- [ ] Boosts: high-quality artwork/about page, interesting niche, authentic human engagement, active owner/admins
- [ ] Penalties: bots/fake accounts, spam/low-quality engagement, low-quality artwork/about page, off-platform payments, bad support, inactive owner

## Skool policy / pricing (verify in Skool help + settings)

- [ ] Owner plan trial end date is captured (absolute date) and billing amount matches expectation
- [ ] Member pricing is free (unless intentionally changed)
- [ ] External links policy is respected (intake/guide/checkout links allowed)

## Offer truth checks (verify in repo)

- [ ] `docs/COMMERCIAL_TRUTH.md` still current and matches the offers mentioned in Skool copy
- [ ] Diagnostic is only described as “available” when `THUMBGATE_SPRINT_DIAGNOSTIC_CHECKOUT_URL` is configured
- [ ] Pro checkout link uses `https://thumbgate-production.up.railway.app/checkout/pro` (preferred) or `https://thumbgate.ai/checkout/pro` if that domain redirects correctly

## Evidence / proof links (verify in repo)

- [ ] `docs/VERIFICATION_EVIDENCE.md` exists and is linkable
- [ ] Proof reports exist:
  - [ ] `proof/compatibility/report.md`
  - [ ] `proof/automation/report.md`

## Notes (fill during refresh)

- Date verified (local time):
- Skool discovery notes:
- Skool discovery status (Listed/Unlisted) + rank:
- Skool limits/policies discovered:
- Any copy updates needed:
