# Install ThumbGate Codex Bridge for Claude Code

## One-command session install

```bash
claude --plugin-dir "$(pwd)/plugins/claude-codex-bridge"
```

That loads the plugin for the current Claude Code session and makes the following skills available:

- `/codex-bridge:setup`
- `/codex-bridge:review`
- `/codex-bridge:adversarial-review`
- `/codex-bridge:second-pass`
- `/codex-bridge:status`
- `/codex-bridge:result`

## Verify

```bash
claude plugin validate plugins/claude-codex-bridge
node plugins/claude-codex-bridge/scripts/codex-bridge.js setup
```

Expected setup proof:

- `codexInstalled: true`
- `reviewCommand: true`
- `execCommand: true`
- `dataDir` points at the plugin data directory

## Typical flow

1. Run `/codex-bridge:review base=main` before merge.
2. Run `/codex-bridge:adversarial-review` before deploy or publish.
3. Run `/codex-bridge:second-pass focus on billing webhook hardening` when you want Codex to take another shot.
4. Run `/codex-bridge:status` or `/codex-bridge:result` to inspect the saved artifact.

## Codex prerequisites

- `codex` must be installed and authenticated on the machine.
- ThumbGate's existing Codex MCP profile still lives at `plugins/codex-profile/`.
- This bridge plugin does not replace the Codex profile; it gives Claude Code a clean way to call Codex from the same repo.
