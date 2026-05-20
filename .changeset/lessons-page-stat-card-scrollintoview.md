---
"thumbgate": patch
---

Fix /lessons stat-card clicks that appeared to do nothing — switchTab() now scrolls the active tab content into view so the user sees a visible response. Without scrollIntoView, clicking "Active Rules" / "Critical" / "Actions Blocked" / "Approval Trend" was a silent no-op from the user's POV: the handler fired and the tab class flipped, but the tab content was below the fold and the page never scrolled to it. CEO reported the bug; verified the silent-handler symptom by inspection.

Also: 17 new Playwright E2E tests in `tests/e2e/lessons-page-clickability.spec.js` cover EVERY deterministic clickable surface on /lessons — 4 stat tiles, 3 tab headers, 4 rules filter buttons, 3 timeline filter buttons, 2 nav anchors, plus a render assertion. Each tile click test asserts the tab content is in-viewport after click (catches future scrollIntoView regressions). Closes the E2E coverage gap from PR #2242 (which only tested the dashboard stat cards, not the lessons-page tiles).
