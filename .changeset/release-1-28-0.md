---
"thumbgate": minor
---

Release 1.28.0 — self-protection gates now bind regardless of enforcement posture. `self-protect-kill` (killing the enforcement engine) and `self-protect-env-override` (exporting `THUMBGATE_*`/`LANEKEEP_*` to disable checks) hard-deny by default instead of degrading to a warning under warn-by-default. A deliberate owner escape, `THUMBGATE_SELF_PROTECT_OVERRIDE=1`, prevents self-lockout. The change is targeted: non-self-protective denies (e.g. force-push) still follow warn-by-default. Ships the accumulated fixes since 1.27.20, including the `deny-network-egress` host-boundary bypass (#2807).
