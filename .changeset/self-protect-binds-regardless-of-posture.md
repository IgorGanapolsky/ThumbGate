---
"thumbgate": minor
---

Self-protection gates now bind regardless of enforcement posture. Previously every gate — including the ones guarding ThumbGate's own kill switch and env overrides — degraded to a warning under warn-by-default, so an agent could run `pkill -f gates-engine` or `export THUMBGATE_HOTFIX_BYPASS=1` and only be warned, by which point the guardrail was already gone. `self-protect-kill` and `self-protect-env-override` now hard-deny by default. A deliberate owner escape, `THUMBGATE_SELF_PROTECT_OVERRIDE=1`, prevents self-lockout (break-glass covers `.claude/settings*` but not the self-protect surface). The change is targeted: non-self-protective denies (e.g. force-push) still follow warn-by-default. The file-edit self-protect gates (`self-protect-config`, `self-protect-hooks-disable`) remain shadowed by `protected-file-approval-required`/`workflow-sentinel` and are approval-gated; hardening those to hard-deny requires gate reordering and is a tracked follow-up.
