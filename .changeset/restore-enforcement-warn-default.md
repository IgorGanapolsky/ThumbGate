---
"thumbgate": patch
---

fix(enforcement): restore the firewall — warn-by-default, hard-block only catastrophic

The 2026-06-03 hotfix made `gate-check` bypass ALL enforcement by default (it
approved every action, and shipped that way to npm), so ThumbGate's firewall did
not actually fire. Restored enforcement with a safe posture (CEO decision
2026-06-04):

- `bin/cli.js`: the blanket bypass is now an explicit opt-in escape hatch only
  (`THUMBGATE_HOTFIX_BYPASS=1`); enforcement runs by default.
- `gates-engine.js` `applyEnforcementPosture`: warn-by-default — gates still fire
  and log every decision, but downgrade deny/approve → warn so legitimate work is
  never hard-blocked. A tight catastrophic FLOOR keeps hard `deny` for
  irreversibly destructive **commands** (rm -rf / mkfs / dd-to-disk / fork bomb /
  terraform destroy) and secret exfiltration. Only the executed command
  (Bash command/cmd/script) is inspected — writing/editing a file that merely
  *mentions* `rm -rf` is NOT blocked.
- Full hard enforcement is available via `THUMBGATE_STRICT_ENFORCEMENT=1`.

Verified by real gate-check scenarios (rm -rf → deny; git push → warn; Write/Edit
mentioning rm -rf → warn; bypass → approve; strict → deny) and the gate test
suites (gates-engine 167/0, cli 93/0, enforcement-teeth 38/0).
