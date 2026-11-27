---
"thumbgate": patch
---

MCP tools that return a list (such as `retrieve_lessons`) now send it as `structuredContent.results`, so clients no longer reject the call. The text block is unchanged.
