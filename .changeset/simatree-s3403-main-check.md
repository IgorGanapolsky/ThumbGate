---
"thumbgate": patch
---

fix(governance): use the path-based main check in the Simatree governance CLI

The Simatree governance CLI shipped its entry guard as the `require.main` strict-equality form, which SonarCloud flags as rule `javascript:S3403` (MAJOR) — an always-false comparison under strict type inference.

Replaced with the path-resolve form this repo already standardises on (`process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)`), matching `scripts/agent-action-inventory.js`, `scripts/compact-memory-store.js`, and `scripts/budget-aware-gates-proof.js`.

Behaviour is unchanged and now pinned by a test: `require()` returns the exports and prints nothing even when `process.argv` carries `--doctor`, while direct invocation still runs `--doctor`, `--eval`, and `--sql`.
