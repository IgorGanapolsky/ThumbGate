---
"thumbgate": patch
---

Add sandbox scope to spec-gate constraints for secure code execution environments. Adds 2 sandbox-specific constraints (no-sandbox-network, no-sandbox-fs-escape) to agent-safety spec. Also adds workflow-gate-checkpoint module for persisting gate state across long-running workflow restarts. Inspired by Vercel's Open Agents infrastructure.
