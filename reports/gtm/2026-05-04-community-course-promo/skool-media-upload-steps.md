# Skool — Media Upload Steps (Approval-Ready)

Generated: 2026-05-04

Do not upload in this automation run. This is the exact checklist to execute after approval.

Local asset check (must be true before starting):

```bash
ls -la docs/marketing/assets | rg 'thumbgate-(skool|operator-lab)'
```

## 1) Cover image

- Upload file: `docs/marketing/assets/thumbgate-skool-cover-1084x576.png`
- Skool path (expected): Settings → General → Cover photo

## 2) Group icon

- Upload file: `docs/marketing/assets/thumbgate-skool-icon-128x128.png`
- Skool path (expected): Settings → General → Group logo

## 3) About media (optional)

Pick one of each (confirm before upload):

- Hero image candidate: `docs/marketing/assets/thumbgate-operator-lab-about-hero.png`
- Explainer video candidate (landscape): `docs/marketing/assets/thumbgate-operator-lab-explainer.mp4`
- Explainer video candidate (vertical): `docs/marketing/assets/thumbgate-operator-lab-explainer-vertical.mp4`

If Skool limits you to one media item on About, prefer the hero image first.

Optional: add a second image to About (or use for future posts):

- Social landscape: `docs/marketing/assets/thumbgate-operator-lab-social-landscape.png`
- Social square: `docs/marketing/assets/thumbgate-operator-lab-social-square.png`
- Social story: `docs/marketing/assets/thumbgate-operator-lab-social-story.png`
