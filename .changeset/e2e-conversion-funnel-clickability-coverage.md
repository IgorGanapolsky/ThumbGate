---
"thumbgate": patch
---

**E2E coverage expansion for the conversion funnel.** PR #2268 added comprehensive clickability coverage for `/lessons`, but the four highest-priority public pages a real visitor traverses on the way to revenue still had zero Playwright clickability assertions. CEO directive: "100% e2e verification."

Four new Playwright specs at `tests/e2e/<page>-clickability.spec.js`, each enumerating every deterministic clickable surface on its page and asserting a visible effect (URL change, content swap, accordion toggle, copy-hint flip, scroll-into-view) per click — never just "handler fired."

Per-page test counts:

- `/` (landing) — 19 tests (hero copy/CTAs, in-page nav anchors, FAQ accordion, pricing section CTAs, sticky bottom CTA)
- `/dashboard` — 21 tests (auth bar + Connect, Try Demo, 8 tab headers, 4 source filters, Mark Reviewed, DPO export, nav)
- `/agent-manager` — 11 tests (5 nav links, 2 primary CTAs, 3 related-reading links, render check)
- `/pricing` — 18 tests (5 nav links, 3 plan CTAs, scope-first link, 5-item FAQ accordion, 5 footer links)

Total: **69 new tests**, none duplicating the four stat cards already covered by `tests/e2e/dashboard-stat-cards.spec.js`.

Three of the `/` landing-page tests **intentionally fail** because they expose a real bug: `toggleFaq` and `handleFaqKeydown` in `public/index.html` are defined inside an IIFE, so the inline `onclick="toggleFaq(this)"` attributes throw `ReferenceError` and the entire FAQ accordion is dead. This PR does not fix the page bug — it surfaces it with a failing test so a follow-up can hoist the handlers to the window scope. The other 66 tests pass.

npm scripts added: `test:index-page-clickability`, `test:dashboard-page-clickability`, `test:agent-manager-page-clickability`, `test:pricing-page-clickability`.
