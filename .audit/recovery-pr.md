## Change

Recover four features stranded in conflicted or closed PRs onto current main: agent context validation (#3891), per-session export gating (#3889), behavioral coverage gaps (#3888), and session interactivity metrics (#3673). Source commits stay separate; the final commit integrates the CLI and package boundary.

Explicit false flags now keep opt-outs intact. Denied exports omit payloads and destination/audit file aliases are rejected before truncation. Empty coverage cannot claim readiness, and incomplete or overlapping session measurements cannot claim speedups. These restore Reliability Gateway capabilities without replaying obsolete integration files.

Part of #4076. Supersedes #3891, #3889 and #3888 after this successor is verified and merged. Graph recovery from #3650 is separate.

## Validation

- 87 feature and secret-redaction tests passed, including red-first regression cases.
- Independent review passed 99 feature, redaction and package tests at a8deee6e5f243102311423253858ce4511cdd5fb. Review also verified executable source stays in coverage gaps and unsorted session turns produce chronological context growth.
- CLI suite passed 97 tests; package/parity passed 17; runtime tarball dependency checks passed 5.
- Dry pack measured 604 files and 9,012,318 bytes. Seven recovered runtime entries account for the increase from 597; budgets are 604 files and 9,025,000 bytes.
- git diff --check passed. Independent shipping review passed; full exact-head CI remains required.

Existing project verification reference: [VERIFICATION_EVIDENCE.md](./VERIFICATION_EVIDENCE.md). No production deployment or performance improvement is claimed.
