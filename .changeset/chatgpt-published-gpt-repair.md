---
"thumbgate": patch
---

fix(chatgpt): harden the published GPT feedback-capture repair packet

The ChatGPT GPT setup guide now fails closed when `captureFeedback` is unauthenticated or unavailable: it must say "Not saved in ThumbGate yet" instead of implying a reusable lesson was saved. The GPT Store packet also pins the canonical ThumbGate avatar and records a live audit of the published GPT drift so the wrong icon, stale Action instructions, and Bearer-auth setup issue can be repaired from evidence.
