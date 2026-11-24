---
"thumbgate": patch
---

The local dashboard no longer pins its scripts, styles and pages in the browser as immutable for 24 hours. A tab kept the previous build's project-switcher.js after an upgrade and showed 0 feedback for a project that had 35. Scripts, styles and pages now revalidate on every load; images and fonts stay cached.
