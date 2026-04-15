---
"thumbgate": patch
---

Add gate-eval module for systematic evaluation of gate effectiveness. Operators define eval suites (expected block/pass outcomes), run them against specs, get precision/recall/F1 metrics, compare spec versions A/B, and track effectiveness trends over time. Ships with 16-case agent-safety eval suite. Inspired by Anthropic's prompt evaluation framework.
