---
"thumbgate": patch
---

Harden secret-exfiltration PreToolUse detection for structural vectors (command substitution, curl @file path findings, pipe-to-network, scp/rsync, secret env vars) so the deny-by-default claim matches real coverage beyond literal secret scanners.
