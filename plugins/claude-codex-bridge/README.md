# ThumbGate Codex Bridge for Claude Code

This repo-local Claude Code plugin brings Codex into the same workflow for three high-ROI cases:

- independent review of uncommitted work or a base diff
- skeptical adversarial review before risky merges or deploys
- second-pass handoff when you want a different agent to take another shot

The plugin keeps ThumbGate's local reliability memory available through the bundled `thumbgate` MCP server while the bridge script persists Codex artifacts in `${CLAUDE_PLUGIN_DATA}`.

## Shipped skills

- `/codex-bridge:setup` — verify Codex CLI, plugin data path, and ThumbGate MCP wiring
- `/codex-bridge:review` — run a normal Codex review against `--uncommitted`, `--base`, or `--commit`
- `/codex-bridge:adversarial-review` — run a stricter review focused on hidden regressions and security risk
- `/codex-bridge:second-pass` — hand off the current task or diff to Codex for a second pass
- `/codex-bridge:status` — show the latest saved bridge artifact metadata
- `/codex-bridge:result` — print the last saved Codex output

## Install

Run Claude Code with the repo-local plugin loaded:

```bash
claude --plugin-dir "$(pwd)/plugins/claude-codex-bridge"
```

Validate the plugin shape before shipping changes:

```bash
claude plugin validate plugins/claude-codex-bridge
```

The plugin launches ThumbGate's MCP server automatically through `plugins/claude-codex-bridge/.mcp.json`, so Claude Code gets the reliability tools without extra configuration.

## How it works

1. Claude invokes a bridge skill such as `/codex-bridge:review`.
2. The skill runs `plugins/claude-codex-bridge/scripts/codex-bridge.js`.
3. The bridge script shells out to `codex exec review` or `codex exec`.
4. Codex output is saved under `${CLAUDE_PLUGIN_DATA}/runs/`.
5. `/codex-bridge:status` and `/codex-bridge:result` replay the latest artifact without rerunning Codex.

## Why this matters

ThumbGate is not trying to replace Codex. The point is to give Claude Code users a fast second reviewer and adversarial pass while keeping pre-action gates, thumbs-up/down feedback memory, and proof artifacts local-first.
