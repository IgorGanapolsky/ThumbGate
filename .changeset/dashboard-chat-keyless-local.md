---
"thumbgate": patch
---

Fix dashboard "Chat with your data" for keyless local installs: the exact metric question "how many mistakes were prevented today?" is now covered by the local-data regression test with every cloud/model env var removed, and the dashboard copy no longer implies Gemini/Perplexity keys are required for local answers.
