---
'thumbgate': patch
---

Fix 59 pre-existing test failures: add `commit.gpgsign=false` to temp-repo helpers so tests work in signing-enforced environments; make `trackEvent` respect `THUMBGATE_API_URL` to prevent DNS hangs in sandboxed CI; add `process.exit(0)` to unlicensed pro command paths for clean CLI exit.
