---
"thumbgate": patch
---

Add the OpenMono adapter contract under adapters/openmono/.

OpenMono is a terminal-native local-LLM coding agent that already ships a
Docker sandbox, a single enforcement chokepoint, fixed doom-loop detection and
per-sub-agent turn budgets. Every one of those controls is static and per-run,
so nothing learns between run 1 and run 500. This adapter describes the
ThumbGate side of that integration: cross-session lesson persistence, adaptive
loop detection instead of a fixed 3x threshold, and evidence-based turn budgets.

The config and install notes are deliberately not added to the npm files list
yet. The runtime binding is proposed upstream and unconfirmed, so shipping it
in the published package would claim an integration that does not execute.
