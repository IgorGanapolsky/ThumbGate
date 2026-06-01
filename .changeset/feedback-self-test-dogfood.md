---
"thumbgate": minor
---

Add `thumbgate feedback-self-test` and the `thumbgate dogfood` alias to prove feedback capture is wired before agents claim thumbs signals are being stored.

The command captures a synthetic thumbs signal, verifies both `feedback-log.jsonl` and `memory-log.jsonl`, uses an isolated test store by default, and supports `--persist` when intentionally dogfooding the active project store. The Codex onboarding prompt now points first-time users to this short proof command instead of a long multi-flag capture example.
