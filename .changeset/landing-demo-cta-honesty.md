---
"thumbgate": patch
---

fix(landing): replace broken 90-second demo link with honest CTA

The hero "Watch the 90-second demo" anchor on `/` pointed to `#demo`,
which scrolled to a section that no longer hosts a video — the link
landed visitors on an empty placeholder. Replace with an honest CTA
that directs to a real, available surface so the landing-page promise
matches what's actually there. Companion E2E coverage updated in
`tests/e2e/index-page-clickability.spec.js`.
