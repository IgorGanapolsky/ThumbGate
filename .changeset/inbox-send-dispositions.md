---
"thumbgate": patch
---

Update `scripts/thumbgate-inbox-sentinel.js` and `AGENTS.md` to classify inbox threads into six exhaustive dispositions (`REPLIED`, `DRAFTED_FOR_APPROVAL`, `NO_REPLY_NEEDED`, `WAITING_FOR_INFORMATION`, `BLOCKED`, `OPTED_OUT`) with send-by-default for ordinary business correspondence, approval-exception rules, mail-provider send confirmation tracking, runtime JSONL disposition ledger, and end-of-cycle reporting.
