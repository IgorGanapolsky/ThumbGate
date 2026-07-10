---
thumbgate: patch
---

Release 1.27.20 — ship a complete npm tarball.

Published 1.27.19 was cut from an untracked working directory and omitted 32 files (including `scripts/feedback-sanitizer.js`), which crashed the UserPromptSubmit hook on every prompt. This release publishes the full file set from `main` through CI (tagged, provenance-signed) and includes the pack-integrity regression guard so an incomplete tarball can never publish again.
