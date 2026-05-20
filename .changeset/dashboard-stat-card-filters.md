---
"thumbgate": patch
---

Fix Operations Dashboard stat-card filters so clicking Positive/Negative/Total navigates to the Lessons Timeline tab pre-filtered to that signal (previously all three cards landed on the Rules tab unfiltered — the dashboard emitted `?signal=positive|negative` but `lessons.html` never parsed the query param).

Two changes:

1. **`public/dashboard.html`** — switch stat-card hrefs to the canonical `up|down|all` vocabulary the rest of the codebase uses (was `positive|negative`).
2. **`public/lessons.html`** — read `?signal` at bootstrap, accept both canonical (`up|down|all`) and legacy (`positive|negative`) aliases, call `switchTab('timeline') + filterTimeline(mapped)` before falling through to the default Rules tab.

Adds a Playwright E2E suite (`tests/e2e/dashboard-stat-cards.spec.js`) and a sharded GitHub Actions workflow (`.github/workflows/e2e.yml`) so this regression class is caught in CI on any future change to `public/`, `src/api/`, or the test infrastructure itself.
