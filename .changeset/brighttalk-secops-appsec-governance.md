---
"thumbgate": minor
---

feat(governance): add unified AI SecOps governance harmonizer and 10-point deterministic AppSec preflight guard from BrightTALK research

- Add `scripts/unified-ai-secops-governance.js` with 3-tier autonomy matrix, single-pass cryptographic dual audit records, and governance-vs-SecOps policy conflict scanner (Noah Kenney / Digital 520 model).
- Add `scripts/deterministic-appsec-guard.js` implementing a fail-closed 10-point deterministic AppSec preflight firewall (Ralph Villanueva / Carnival Corp model).
- Add engine configuration manifests `config/gates/secops-governance-harmonizer.json` and `config/gates/deterministic-appsec-guard.json`, read directly by the two engines above. They are deliberately NOT registered as harness manifests: `scripts/gates-engine.js` only loads a top-level `gates` array, so registering a `rules`/`invariants` manifest would add zero gates while making every matched tool call look governed. `tests/harness-selector.test.js` now pins the invariant that every registered harness resolves to a manifest with a non-empty `gates` array.
- The autonomy matrix fails closed: only actions on the `autonomousAllowed` list reach `AUTONOMOUS_ALLOWED`; anything unrecognised is escalated for human approval rather than assumed safe.
- `deterministic-appsec-guard --scan-file` exits nonzero when it blocks, so a CI preflight fails the build without parsing stdout, and Rule 01 binds its authentication check to each individual route rather than to the whole scanned file.
- Add public educational guides `public/learn/harmonizing-ai-governance-secops.html` and `public/learn/10-common-sense-appsec-guardrails.html`.
- Add enterprise co-sell proposals in `pitch/noah-kenney-digital520-partnership-pitch.md` and `pitch/ralph-villanueva-carnival-appsec-pitch.md`.
