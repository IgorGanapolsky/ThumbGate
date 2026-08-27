---
"thumbgate": patch
---

Add measured performance budgets for the PreToolUse hot path (2026-08-26 engineering directive: performance is a design constraint, not late-stage cleanup).

- `config/performance-budgets.json` — p95 budgets for the four PreToolUse hot paths (state rebuild, per-call eval, compiled-guard eval, artifact compile), production endpoint latency targets (including the billing summary that measured a 15s timeout on 2026-08-26), and pointers to the existing unit-economics sources.
- `scripts/perf-budget-check.js` — the single measurement tool: hermetic `--local` micro-benchmarks over synthetic fixtures (CI-safe, 3x headroom multiplier) and post-deploy `--prod` endpoint timing. Baseline on an M-series Mac: state rebuild p95 11.2ms, per-call eval p95 0.01ms.
- `tests/perf-budget.test.js` (`npm run test:perf-budget`, wired into the suite) — fails CI when a measured p95 breaches its budget, so hot-path regressions surface at review time instead of in production.
- AGENTS.md: hot-path PRs must include the harness output as benchmark evidence.

The config file is excluded from the npm tarball (`!config/performance-budgets.json`), keeping the bundle ratchet untouched.
