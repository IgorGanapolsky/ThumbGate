---
"thumbgate": patch
---

Add allowlist-bridge-honesty (GitLab 2026-09 FORMAT steal): treat allowlisted package registries, proxies, and Hugging Face hosts as hops rather than trust boundaries; deny credentialed requests on those hops; keep observe-mode from promoting proxies onto allowHosts; classify hook/CI/MCP writes as trust-handoff. Does not clone GitLab Duo.
