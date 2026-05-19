---
"thumbgate": patch
---

Aligns `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` with the Anthropic official plugin marketplace submission form (https://claude.ai/settings/plugins/submit). Changes:

**plugin.json:**
- Short description rewritten to the submission-form copy (178 chars, under the 200-char form limit, includes "PreToolUse Pre-Action Checks" for backward compat with the claude-mcpb regression test)
- Author block now includes email + url
- Added `category: "developer-tools"`
- Keywords expanded to include the 8 submission-form tags (guardrails, pretooluse, hooks, feedback, rlhf, dpo, agent-safety, workflow-hardening)

**marketplace.json:**
- Same short description
- New `longDescription` field — the full tripwire-not-memory-layer narrative from the submission form (verifiable claims only: 33 pre-action checks, Claude Code / Cursor / Codex / Gemini / Amp / Cline / OpenCode adapter coverage, NIST/SOC2/OWASP/CWE tags, DPO export, Free + Pro $19/mo tiers)
- `category: "developer-tools"` + 8 submission-form `tags`
- New `capabilities` block: skills 2, commands 5, agents 1, hooks 3, mcpServer "thumbgate serve"
- New `installCommand: "/plugin install thumbgate@claude-plugins-official"`
- Author email + url
- `keywords` expanded to match

51/51 tests pass across `version-metadata`, `package-boundary`, `claude-mcpb`, `skill-exporter`, `thumbgate-skill`, `public-package-parity`. Bundle ratchet unchanged.

This is the minimum manifest delta the marketplace submission needs. Demo GIF + npm version bump are separate workstreams.
