---
"thumbgate": patch
---

dashboard: chat answers are now intent-aware and specific, not one canned template

The "Chat with your data" answerer matched a topic and returned a fixed line, so
different questions ("how many gates were activated" vs "what mistakes were
blocked") returned the IDENTICAL "Active gates: N. Blocked actions recorded: M."
output. Now:

- "what / which was blocked" lists the actual gates that fired (from the per-gate
  breakdown): "Most-blocked: memory-high-risk-default-deny (62x), secret-exfiltration (38x)…"
- "how many" distinguishes configured gates (active & watching) from the ones that
  have actually fired, plus actions blocked vs warned — instead of conflating them.
- Honest "today" handling: counts are cumulative for the install; the answer says
  so rather than implying a per-day figure that isn't computed yet.
- Overview gives a real snapshot instead of "ask about X".

Consolidates the dashboard-chat answerer into one canonical implementation.
