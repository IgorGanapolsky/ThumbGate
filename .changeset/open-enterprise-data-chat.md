---
"thumbgate": patch
---

Move the Enterprise dashboard chatbot away from Dialogflow-first framing to a local/open-source Governed Data Chat path. `/v1/chat` now accepts `THUMBGATE_LOCAL_LLM_ENDPOINT` / `THUMBGATE_LOCAL_LLM_MODEL` for OpenAI-compatible local models, augments lesson retrieval with optional LanceDB vector matches, and exposes `/v1/enterprise/data-chat/*` as the primary enterprise status/chat API while retaining legacy `/dialogflow/*` aliases.
