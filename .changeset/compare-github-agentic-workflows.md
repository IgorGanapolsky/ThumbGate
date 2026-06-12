---
"thumbgate": patch
---

Add `/compare/github-agentic-workflows` — a comparison page positioning ThumbGate against GitHub Agentic Workflows (public preview, June 2026). GitHub governs coding agents inside GitHub Actions behind its Agent Workflow Firewall (read-only by default, threat-detection scan before changes apply); ThumbGate governs the coding agent on the developer's machine in the PreToolUse hook, before any PR or CI run exists. The page uses the established "two layers of the same defense" framing — credits GitHub's CI-layer governance, differentiates on the local dev-loop layer, and notes the two compose (ThumbGate's `gate-check` can also run inside an Actions runner). Linked from the `/compare` hub; auto-included in the sitemap.
