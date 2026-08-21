---
'thumbgate': patch
---

Bound the two remaining unbounded JSONL readers on the `/v1/dashboard` assembly path so an oversized production log degrades to a bounded tail instead of throwing V8's "Cannot create a string longer than 0x1fffffe8 characters" and returning 503 "Dashboard data too large". Intervention-policy retraining now reads its own, much larger training window rather than inheriting the dashboard tail, and both the policy summary and the telemetry summary report whether the underlying read was truncated so partial counts are never presented as complete lifetime analytics.
