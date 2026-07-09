---
"thumbgate": minor
---

Wire signed, auto-expiring entitlement tokens into the Pro license gate. `verifyLicense()`/`isProLicensed()` now accept a signed entitlement token (via `THUMBGATE_LICENSE` or the local license file) in addition to legacy `tg_pro_` prefix keys. A signed Pro token grants Pro until its `exp`, then verification fails and the caller reverts to free — making a real time-limited Pro trial possible (previously only non-expiring prefix keys unlocked Pro, so a "30-day trial" was impossible). Backward compatible: existing prefix keys keep working unchanged.
