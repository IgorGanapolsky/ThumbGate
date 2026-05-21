---
"thumbgate": patch
---

fix(dashboard): Active Gates stat-card click now activates the Gates tab + scrolls it into view

Clicking the Active Gates card on /dashboard previously appeared to do nothing.
Two bugs in switchTab():

1. The selector `document.querySelector('[onclick*="<name>"]')` matched the
   stat-card (first in DOM order) instead of the tab header for that name,
   so the tab header never lit up as active.
2. The tab content panel did get .active, but it sat below the fold; with
   no scrollIntoView, the user perceived "nothing happened" because the
   newly-visible content was off-screen.

Fix: scope the header selector to `.tab`, and call
`contentEl.scrollIntoView({ behavior: 'smooth', block: 'start' })` after
activating the panel. Regression pinned by two new tests in
tests/e2e/dashboard-stat-cards.spec.js.
