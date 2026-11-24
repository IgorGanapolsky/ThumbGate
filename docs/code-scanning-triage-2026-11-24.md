# Code-scanning triage, 24 Nov 2026

Source: `gh api repos/IgorGanapolsky/ThumbGate/code-scanning/alerts?state=open&ref=refs/heads/main` returned 33 open alerts at 12:50 PM (base `1406eb337`). Classified by reading the code at each location. Nothing was dismissed; the false-positive rows below wait for the lead's decision.

## Fixed in this PR (4 CodeQL alerts, all in tests)

| Alert | Rule | Location | Fix |
|---|---|---|---|
| 595 | js/bad-tag-filter | tests/checkout-human-gate.test.js:652 | closing tag regex now `<\/script\s*>` |
| 596, 597 | js/bad-tag-filter | tests/funnel-copy.test.js:16, 42 | same |
| 598 | js/incomplete-url-substring-sanitization | tests/sso-next-redirect.test.js:146 | `assert.doesNotMatch(hostile, /evil\.com/)` instead of `includes` |

## Proposed false positives (29 alerts, not dismissed)

| Alerts | Rule | Why not a defect in shipped code |
|---|---|---|
| 567 | S1313 hard-coded IP | `src/openshell-lovable-engine.js:29` is the SSRF denylist (metadata hosts, loopback, link-local). The constants are the check. |
| 546-555 (10) | S4036 PATH-searched executable | `npm`, `git`, `curl`, `security` run from local CLI/maintenance scripts with fixed argument lists (`execFileSync` with arrays in sequence-guard, sync-workspace-obsidian, operational-integrity). The binary is chosen by the user's own PATH; no attacker-writable PATH is in scope. Low severity. |
| 534, 535, 557 | S8689 sensitive data in logs | rubric-engine.js and workflow-gate-checkpoint.js print rubric config and checkpoint JSON that the user passed in; no credential value reaches the log line. |
| 537-539, 543, 544, 558, 559 | S8707 path traversal | `fs-utils.js`, `intervention-policy.js`, `workflow-gate-checkpoint.js` read/write the path a local CLI user or the caller's own feedback dir gives. The user already has that file access; there is no privilege boundary crossed. |
| 536, 540, 541, 542 | pythonsecurity S8706/S8707 | `feedback_quality_eval.py` and `train_from_feedback.py` take `--db`, `--write-report`, config paths from the operator's command line. Same reasoning. |
| 545 | S5145 log injection | `apple-minions-idle-compute-steal.js:404` prints a local response to the terminal. |
| 512-514 | js/system-prompt-injection | `scripts/llm-client.js` is a pass-through client; `systemPrompt` is a parameter from the caller by design. Open question: whether any hosted route feeds request input into it (not traced here). |

Counts: 4 fixed + 29 proposed false positives = 33.

## Why new alerts reach main

Live ruleset `main governance` (id 20726461) contains only `required_linear_history`, `deletion`, `non_fast_forward`. Classic branch protection returns none. So neither CodeQL nor SonarCloud is a required check and no `code_scanning` rule exists. Not changed here: editing a live ruleset is the owner's call.
