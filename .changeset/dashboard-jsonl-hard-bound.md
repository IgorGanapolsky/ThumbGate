---
"thumbgate": patch
---

Harden dashboard JSONL ingestion so omitted limits no longer full-read multi-hundred-MB feedback logs (prod `dashboard_data` 503 / V8 string limit). Defaults: 4 MiB / 20k-line tail; opt-in `{ full: true }` for lifetime scans.
