---
"thumbgate": patch
---

Stop the MCP stale-lock reaper from killing live servers. Lock holders now refresh a heartbeatAt field every 60 seconds (THUMBGATE_LOCK_HEARTBEAT_MS to override) via atomic tmp+rename writes, and the reaper only fires on a holder whose heartbeat is older than THUMBGATE_LOCK_STALE_MS (clamped to at least 3 beats). Previously any agent session older than 2 hours had its MCP server reaped by the next server start against the same feedback dir, and its next tool call failed with "Transport closed". Reaping is now verified-kill: SIGTERM, a grace period, then SIGKILL escalation for wedged event loops, and the lock is claimed only once the holder cannot run again — an unsignallable holder is left alone and the new server coexists. The primary lock is claimed with O_EXCL so simultaneous starters cannot both become primary, and stranded heartbeat tmp files are swept on startup.
