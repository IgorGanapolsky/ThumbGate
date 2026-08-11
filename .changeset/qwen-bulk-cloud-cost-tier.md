---
"thumbgate": minor
---

Add a bulkCloud cost-saver tier to the risk-aware model router: steady high-output task types (bulk-generation, batch-processing, high-output-coding, content-generation, bulk-automation) route to a cheap OpenAI-compatible cloud flagship (Qwen3.8-Max class, ~$2/M input and ~$6/M output vs frontier ~$15/M output) configured via THUMBGATE_BULK_CLOUD_BASE_URL / THUMBGATE_BULK_CLOUD_API_KEY. Tiers may now declare pricingUsdPerMTok, and executeRoutedGeneration derives real costCents telemetry from usage tokens when the adapter reports none, so routing-holdout cost-savings metrics work out of the box. New estimateTierCostUsd export; existing tier mappings and escalation rules unchanged.
