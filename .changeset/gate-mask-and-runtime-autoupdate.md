---
"thumbgate": patch
---

A hard-block gate now still denies when an earlier gate is demoted to a warning. A pending PR-thread check left by another repo used to hide `terraform destroy`, force-push and similar denies, and it no longer applies from a folder outside any git repo; Claude `gate-check` and Cursor `cursor-gate` both deny. The hook runtime now keeps up with npm: `thumbgate init` refreshes an older cached runtime instead of printing "already configured", a finished update no longer blocks a newer release for 24 hours, and the hook shim checks npm once a day itself (opt out with `THUMBGATE_NO_AUTO_UPDATE=1`), so runtimes older than 1.43.1 catch up too.
