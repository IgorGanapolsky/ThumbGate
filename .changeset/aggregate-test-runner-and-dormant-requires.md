---
"thumbgate": patch
---

Add `test:all`, an aggregating suite runner, and `lint:dormant-requires`, a dependency-free dead-import detector.

`npm test` chains 360 commands with `&&`, so the first failing suite hides every later one — measured on `d0bb3768`, 8 suites fail but `npm test` halts at `test:ops` (chain position 23 of 374) and reports one. Chain membership is also hand-maintained and had drifted: 46 `test:*` scripts were defined but never executed, including `test:redteam`, `test:stealth-memory-injection`, `test:mcp-policy`, `test:reward-hacking-guardrails` and `test:proactive-agent-eval-guardrails` — 33 assertions that passed on demand while guarding nothing.

`scripts/test-all.js` discovers suites instead of listing them, runs them in parallel and reports every failure, marking previously-unchained suites `[+]`. `scripts/find-dormant-requires.js` reports require bindings never referenced again; it is dependency-free because the repo has no eslint, prettier or lint script.

Also removes `test:copilot-instructions`, which still points at a test file that does not exist on `main`. Successor of #3703: rebased onto current `main` without replacing the hand-maintained `npm test` chain (that would hide 26 newer suites). `test:all` remains the aggregator; `test:tooling-scripts` is appended to `npm test`.
