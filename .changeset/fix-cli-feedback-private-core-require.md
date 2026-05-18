---
"thumbgate": minor
---

**Fix: `hook-auto-capture` crashed with `MODULE_NOT_FOUND` in published thumbgate@1.19.0.**

`scripts/cli-feedback.js` did an unconditional `require('./history-distiller')`. But `history-distiller.js` is a `PRIVATE_CORE_MODULE` — present in the source checkout and in `ThumbGate-Core`, but intentionally excluded from the public npm tarball (see `tests/public-package-boundary.test.js`). When a published install ran the Claude Code `UserPromptSubmit` hook (`hook-auto-capture`), the `require` chain reached `cli-feedback.js`, hit the missing `history-distiller`, and threw — meaning every `thumbs up:` / `thumbs down:` typed in a hooked agent was silently dropped.

Fix: switched the require to `loadOptionalModule('./history-distiller', () => ({ distillFromHistory: () => null }))`, matching the pattern already in use by `scripts/feedback-loop.js` and `src/api/server.js`. The caller in `processInlineFeedback` already handles `distillResult === null` gracefully, so the public-shell state degrades cleanly: feedback is still captured, distillation is skipped.

Regression test in `tests/public-package-boundary.test.js#cli-feedback loads and runs in public-tarball state` forces the public-shell state via the existing `withBoundaryFallbackModule` helper and asserts `processInlineFeedback` returns a feedback record with `distillResult` either null or an object. This locks the bug class for cli-feedback.
