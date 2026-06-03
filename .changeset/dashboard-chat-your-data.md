---
"thumbgate": minor
---

Add **"Chat with your data"** to the local dashboard. A new chat panel lets you ask natural-language questions about this install's captured ThumbGate data — your lessons, mistakes, and prevention rules — and get answers grounded *only* in your retrieved data (RAG), with cited sources.

- New `scripts/dashboard-chat.js`: retrieves the most relevant lessons for the question and asks Gemini to answer using only that context (no hallucinated facts; cites lesson numbers).
- New `POST /v1/chat` endpoint in the API server.
- Chat panel in `public/dashboard.html` (input + cited answers).
- Enabled by `GEMINI_API_KEY` (`npx thumbgate setup-vertex --write`); degrades to a clear "configure your key" message when unset. This is the in-product enterprise "chat with your governed data" experience.
