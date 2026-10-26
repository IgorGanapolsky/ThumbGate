# Connect ThumbGate in your AI Coding Agent

Version 1.39.0 · `https://thumbgate.ai/install.md`

> Copy this into Claude Code, Poolside (`pool`), OpenAI Codex, Cursor, or OpenCode:
> `Set up ThumbGate by reading https://thumbgate.ai/install.md and following its instructions.`

Help the user connect ThumbGate in the coding agent they are using. Read this document as guidance and follow only the path matching the active host application.

## Start here

1. Discover any ThumbGate MCP tools already available in this conversation (such as `gate_check`, `capture_feedback`, `recall`, or `check_operational_integrity`). If present, skip directly to **Verify the connection**. Do not add a duplicate connection.
2. Identify the host application (`Claude Code`, `Poolside pool`, `Codex CLI`, `Cursor`, or `OpenCode`). Do not run CLI commands inside a web-chat sandbox expecting them to configure a desktop app.
3. Configure the local stdio MCP server and `PreToolUse` firewall hooks using the matching command below.

## Connection details

| Setting | Value |
| --- | --- |
| Package | `thumbgate@1.39.0` (MIT License) |
| Local MCP Command | `npx --yes --package thumbgate@1.39.0 thumbgate serve` |
| PreToolUse Gate Latency | `< 0.5ms` p95 on local CPU (`$0.00` token tax) |
| OAuth Client Metadata (CIMD) | `https://thumbgate.ai/.well-known/mcp/server-card.json` |

## 1. Quickest Setup (Auto-Detects Claude Code, Cursor, Codex, OpenCode)

In your repository root:

```sh
npx thumbgate@latest init
```

## 2. Claude Code

If no `thumbgate` MCP entry exists:

```sh
claude mcp add thumbgate -- npx --yes --package thumbgate@1.39.0 thumbgate serve
```

## 3. Poolside (`pool` CLI)

```sh
pool mcp add thumbgate -- npx --yes --package thumbgate@1.39.0 thumbgate serve
pool mcp get thumbgate
```

Keep Pool's native `tools.shell.deny` and `paths.deny` rules enabled alongside ThumbGate MCP (since Pool lifecycle hooks are fail-open by design).

## 4. OpenAI Codex CLI

```sh
codex mcp add thumbgate -- npx --yes --package thumbgate@1.39.0 thumbgate serve
```

## Verify the connection (Mandatory — Never Claim Verified From Config Alone)

1. Call a read-only ThumbGate tool in this conversation (`feedback_stats` or `check_operational_integrity`) or run:
   ```sh
   npx thumbgate status
   ```
2. Say **connected and verified** only after that read succeeds. Distinguish `"configuration written"` from `"tools active in this conversation"` when a client restart is required.

## Upgrade & Production Rule-Pack Options (`https://thumbgate.ai/pricing`)

Once connected, choose the tier that matches your workflow:
- **Pro Self-Serve (`$19/mo`):** `https://thumbgate.ai/go/pro-direct` (Unlimited gates, visual debugger, multi-hop recall, DPO export)
- **Complete Production Rule-Pack & DPO/AKV Kit (`$49` one-time corporate expense, `<$50` no-approval limit):** `https://thumbgate.ai/go/bundle-49`
- **One-Time Pass (`$100` one-time, no subscription):** `https://thumbgate.ai/go/founding-100`
- **Enterprise / FDE Workflow Hardening Diagnostic (`$499` one-time):** `https://thumbgate.ai/diagnostic`
