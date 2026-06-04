---
"thumbgate": patch
---

fix(enforcement): restore the firewall — warn+audit by default, strict opt-in for hard-block

The 2026-06-03 hotfix bypassed ALL enforcement by default (gate-check approved every
action, shipped to npm), so the firewall never fired. Restored with an honest posture
(CEO decision 2026-06-04):

- `bin/cli.js`: the blanket bypass is now an explicit escape hatch only
  (`THUMBGATE_HOTFIX_BYPASS=1`); enforcement runs by default.
- `gates-engine.js` `applyEnforcementPosture`: WARN + AUDIT by default — every gate still
  fires and is logged, but deny/approve downgrade to `warn` so legitimate work is never
  hard-blocked. We deliberately do NOT use a regex "catastrophic floor" to hard-block
  destructive commands: it is unwinnable (sudo / bash -c / find -exec / eval / base64|sh
  all evade it) and gives false confidence.
- HARD enforcement is the explicit opt-in `THUMBGATE_STRICT_ENFORCEMENT=1`, which keeps the
  engine's FULL gate set — its high-risk-command gates catch prefixed/obfuscated forms
  (e.g. `sudo rm -rf /`) far better than any single regex.
- Secret exfiltration and the security-vulnerability scan hard-deny on their own paths
  before this runs, so irreversible data-leak / supply-chain risks stay blocked regardless.

Verified by real gate-check: default → `rm -rf /`, `sudo rm -rf /`, git-commit-mentioning-
rm-rf all WARN (none hard-blocked); `THUMBGATE_STRICT_ENFORCEMENT=1` → `rm -rf /` AND
`sudo rm -rf /` DENY; `THUMBGATE_HOTFIX_BYPASS=1` → approve. Suites: gates-engine 168/0,
cli 93/0, enforcement-teeth 38/0.
