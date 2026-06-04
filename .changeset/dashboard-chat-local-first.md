---
"thumbgate": patch
---

dashboard: "Chat with your data" is local-first, not Gemini

The dashboard chat panel routed every question through Gemini RAG over lessons
only — so it depended on the cloud (contradicting ThumbGate's local-first thesis)
and couldn't answer factual questions like "how many mistakes were blocked
today?" (block counts live in gate/feedback telemetry, not lessons).

`/v1/chat` now answers data/metric questions (gates, blocks, feedback, token
savings, team) DETERMINISTICALLY from this install's own dashboard data — no
cloud, no LLM, no API key. Only open-ended questions fall through to lesson
retrieval + the user's configured LOCAL model; a BYO cloud key is optional. When
no model is configured, open-ended questions still get a local answer instead of
a hard "no_api_key" failure. Dashboard subtitle updated to say answers are local.
