---
"thumbgate": patch
---

seo: wire all live /compare pages into the comparison hub and homepage

The /compare hub linked to only 4 of 13 live comparison pages, and the homepage compare strip to 4 — both hand-maintained lists that drifted every time a new buyer-intent page shipped. Flagship competitor comparisons (claude-code-hooks, arcjet, bumblebee, anthropic-containment, oak-and-sparrow-gatekeeper, anthropic-claude-for-legal) were live and in the sitemap but unreachable from the hub whose entire job is to list them, and the homepage's only link to the hub was `display:none`. That starves the highest-intent pages of internal link equity from the site's top-authority surfaces — directly counter to the GEO/buyer-intent goal those pages exist for.

This makes the hub a complete index of every live comparison (framing grounded in each page's own subtitle, no overclaim), adds the top buyer-intent links plus a visible "Compare all" hub link to the homepage strip, and pins the contract with a regression test (`/compare` must link to every `public/compare/*.html`) mirroring the existing sitemap-completeness test so it cannot silently drift again.
