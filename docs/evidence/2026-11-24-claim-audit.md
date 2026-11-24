# Claim audit: home, pricing, guide (24 Nov 2026)

Base: origin/main f21527fae plus this branch. Status: PARTIAL. Rows marked UNMAPPED were not traced to code or a test and still need an owner. Pages /checkout/pro and the docs landing page were NOT audited.

| # | Claim (page) | Evidence | Status |
|---|---|---|---|
| 1 | It checks the command Claude sends, before it runs (index hero) | `bin/cli.js:3492` `gateCheck`, the PreToolUse hook entry | mapped |
| 2 | A thumbs-down saves your reason and shows it back as a warning on a similar command (index hero, guide) | `docs/evidence/2026-11-24-paraphrase-test.txt`: 17 of 18 rewordings got "Past mistakes relevant"; 0 of 18 denied | mapped |
| 3 | A thumbs-down alone does not block (index box) | same file: 0 denied in default and strict after 1 thumbs-down | mapped; not tested with 3 downs (free cap is 2/day, `capture` exit 1 on the third) |
| 4 | Force-push, `git reset --hard`, `git clean -f`, `rm -rf` on home or root, secret egress are denied by built-in rules (index, pricing) | rule ids `force-push`, `git-reset-hard`, `git-clean-force`, `rm-rf-home-or-root`, `secret-egress` are `block` in the shipped default file (`docs/evidence/2026-11-24-default-rules.txt`); the demo transcript shows DENY for force-push | mapped to config; UNVERIFIED on a fresh install: `scripts/gates-engine.js:334` describes a warn-by-default sidecar mode that downgrades flagged actions |
| 5 | Other flagged actions warn by default; strict mode denies some, not every action (index, FAQ) | `rm -rf ./build-cache` stayed warn in strict (`paraphrase-test` strict rows) | mapped |
| 6 | DROP TABLE is denied by default (index FAQ, pricing) | Run 24 Nov on a fresh empty HOME and feedback dir (free tier), `node bin/cli.js gate-check` with a Bash `psql -c "DROP TABLE users"` payload: permissionDecision deny in default mode and with THUMBGATE_STRICT_ENFORCEMENT=1 | mapped by run |
| 7 | Free keeps your first 3 learned rules active; Pro keeps all (index, pricing) | `scripts/rate-limiter.js:31` `FREE_TIER_MAX_GATES = 3`; `scripts/gates-engine.js:481` `autoGates.slice(0, FREE_TIER_MAX_GATES)` for non-Pro; `scripts/auto-promote-gates.js:738` cap-hit. Read, not run | mapped to code |
| 8 | Strict blocking of catastrophic commands stays free (index FAQ, pricing) | Same fresh-HOME run, five commands (`DROP TABLE`, `git push --force origin main`, `git reset --hard HEAD~3`, `git clean -fd`, `rm -rf ~`): deny in default mode and in strict mode, with no Pro license present. This also shows the five deny in default mode, so the "warn-by-default sidecar" caveat in row 4 does not apply to them | mapped by run |
| 9 | Free CLI limits "2 captures/day (10 total)" (pricing table row wording differs) | CLI output captured 24 Nov: "Free tier: 2 captures/day (10 total)" | mapped to CLI output; pricing wording not compared |
| 10 | Pro is $19/month or $149/year (individual) (pricing, guide) | same CLI output: "Pro ($19/mo or $149/yr (individual))" | mapped to CLI; pricing page template placeholder `__PRO_PRICE_DOLLARS__` not checked against it |
| 11 | Stale auto-promoted gates expire (index "Re-rank" step) | `scripts/auto-promote-gates.js` lines 26 and 440 (TTL) | mapped by comment and code line; not run |
| 12 | Repeated negatives become gates that warn (index) | `scripts/auto-promote-gates.js:19` ("1+ failure auto-promotes to a warning gate") | mapped |
| 13 | Team-shared rules, lessons synced across machines, audit history | pricing marks these "Coming" | mapped to the page's own label |
| 14 | Learned rules also catch "the same mistake" | NOT claimed any more; paraphrase test shows similar commands get a warning, not a block | removed |
| 15 | "<50ms" / "0.4ms" intercept (README) | `grep -n "50ms\|0.4ms" README.md` on this branch returns nothing, so the README no longer makes the claim; no change needed | mapped (claim absent) |
| 16 | Real 58-second run: three thumbs-downs then denied | not reproducible; free cap 2/day; demo DENY came from built-in `untrusted-pipe-to-shell` | removed |

## Per agent: does it block or only warn? (homepage table, corrected in this PR)

| Agent | Block or warn | Evidence |
|---|---|---|
| Claude Code | Blocks (PreToolUse hook can return deny) | `bin/cli.js:3492`; demo transcript DENY |
| Cursor | Shell commands can be denied through the `beforeShellExecution` adapter; other tools advisory. Whether `thumbgate init --agent cursor` installs that hook is NOT verified (a search of `bin/cli.js` was refused by a privacy hook) | `scripts/cursor-shell-gate.js:36-42` returns `permission: deny` |
| Cline | Advisory: the model chooses to call `gate_check` over MCP | `adapters/cline/INSTALL.md` ("Cline calls `thumbgate.gate_check` via MCP before `execute_command`") |
| OpenCode | Advisory by the same MCP route; only `adapters/opencode/opencode.json` (MCP config) found, no hook found | file listing |
| Amp | Feedback only, skills directory only | `adapters/amp/skills` |
| Codex, Gemini CLI, Hermes, Grok | NOT audited | |
