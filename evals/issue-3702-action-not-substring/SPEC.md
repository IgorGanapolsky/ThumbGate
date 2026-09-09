# Issue #3702 — match the action, not the substring

GitHub: https://github.com/IgorGanapolsky/ThumbGate/issues/3702

Do not edit `config/gates/default.json` in this lane.

## FORMAT

| False fire | Required decision |
| --- | --- |
| `gh api …/pulls/3702 -X PATCH -f state=closed` | not `gh-api-pr-create-restricted` |
| `gh api …/pulls -X POST -f title=` | deny `gh-api-pr-create-restricted` |
| `ls config/gates/` | allow (word `policy` is not chmod/IAM) |
| `node -e 'require("./config/gates/default.json")'` | allow (read, not write) |
| `gh api orgs/foo/settings/billing` | allow (no charge) |
| helper write in session-a, execute in session-b | allow in b; deny in a |

## Out of scope

- LLM adjudicator (#3690 / #3687) — ECI pause
- Break-glass rewriting `default.json`
- IdeaBrowser (#3686 leftover)
