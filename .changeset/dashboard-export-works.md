---
"thumbgate": patch
---

Fix the dashboard's DPO download. The project picker script was served as `application/octet-stream`, so browsers refused it and the dashboard failed to connect. A link naming a project with nothing recorded now moves to the project that has data. Download now saves one file with DPO pairs and a KTO list: one `{ prompt, completion, label }` row for every 👍/👎 that recorded the request and the agent's action, so feedback without a written correction is no longer lost.
