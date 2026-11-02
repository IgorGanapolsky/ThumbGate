---
"thumbgate": patch
---

Local OpenAI-compatible chat now sends one stable system prefix plus the changing question, and a loopback probe reports only the cache counters the server actually returns. Vendor rack throughput is refused when a local server probe is attached.
