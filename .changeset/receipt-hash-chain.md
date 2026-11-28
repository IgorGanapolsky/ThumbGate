---
"thumbgate": minor
---

Action receipts are now tamper-evident. Each receipt in `action-receipts.jsonl` carries `seq`, `prevHash` (the hash of the receipt before it) and `entryHash`, so an edited, deleted, inserted or reordered receipt shows up. `thumbgate receipts verify` checks the ledger and exits 1 when it is broken. Each receipt also records `ruleId` (the gate or rule that decided) and `policy`: the ThumbGate version, a SHA-256 of every gate in force and the gate count. Receipts written before this change still read and verify as legacy lines. Cutting receipts off the end of the file can't be detected from the file alone, so keep the head hash that `verify` prints somewhere else.
