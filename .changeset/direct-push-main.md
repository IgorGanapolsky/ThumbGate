---
"thumbgate": patch
---

Maintainers push straight to `main` (Igor, 2026-11-18). The ruleset policy and the branch-protection check no longer expect a `pull_request` or required-status-check rule and flag either one returning as drift. Test workflows run on a `v*` tag or by hand, and the pre-push hook runs the fast unit tests one file at a time.
