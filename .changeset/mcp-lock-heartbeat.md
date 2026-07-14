---
"thumbgate": patch
---

Stop the MCP stale-lock reaper from killing live servers. Lock holders now refresh a heartbeatAt field every 60 seconds (THUMBGATE_LOCK_HEARTBEAT_MS to override) via atomic tmp+rename writes, and the reaper only SIGTERMs a holder whose heartbeat is older than THUMBGATE_LOCK_STALE_MS. Previously any agent session older than 2 hours had its MCP server reaped by the next server start against the same feedback dir, and its next tool call failed with "Transport closed". Wedged processes and pre-heartbeat orphans are still reclaimed.
