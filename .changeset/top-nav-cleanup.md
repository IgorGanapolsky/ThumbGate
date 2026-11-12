---
"thumbgate": patch
---

Remove the broken "Landing Page" nav link from `/dashboard`, `/lessons`, and `/lessons/:id`, unify all three signed-in headers behind one shared `renderSignedInAppNav` renderer (logo linking cleanly to `/`, active `Dashboard`/`Lessons` tabs, GitHub icon), and prevent `preserveProjectQueryParams()` from rewriting `href="/"` links.
