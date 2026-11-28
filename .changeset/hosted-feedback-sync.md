---
'thumbgate': minor
---

New `thumbgate sync-hosted` command pulls thumbs-up and thumbs-down feedback recorded through the hosted connector (claude.ai chats, Claude Desktop, Claude projects, cloud sessions) into the local store, so it becomes the same lessons and gates as feedback typed in a local session. Each hosted event is imported once, only into the matching project (or any project when it has none), and a failed import is retried on the next run. `session-start` runs it in the background when an operator key is configured; `THUMBGATE_HOSTED_SYNC=0` turns that off. See `docs/guides/feedback-everywhere.md`.
