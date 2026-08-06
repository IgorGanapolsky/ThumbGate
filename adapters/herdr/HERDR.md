# ThumbGate Approvals Plugin for Herdr (herdr.dev)

> **The Pre-Action Infrastructure Firewall for Multi-Agent Swarms & Terminal Multiplexers**

Herdr (`herdr.dev`) is the terminal multiplexer built specifically for AI coding agents (Claude Code, Cursor, Codex, Gemini CLI, Amp, Cline). When developers run multi-agent swarms across multiple terminal panes and tabs, background tool execution becomes hard to monitor and audit.

The **ThumbGate Approvals Plugin for Herdr** provides unified, local-first pre-action governance across every active agent pane in Herdr:

- **Pre-Action Execution Interception**: Intercepts terminal commands, tool calls, and spend mutations before they execute in any Herdr pane.
- **Unified Approvals Dashboard**: Surfacing pending approvals directly inside Herdr tabs or via the local ThumbGate HTTP dashboard (`http://localhost:4242`).
- **Cross-Pane Prevention Rules**: Automatic rule promotion from failure signals recorded in one pane to block identical mistakes across all agent panes.
- **Economic & Spend Cap Protection**: Hard stop gates for unauthorized cloud spend, API upgrades, and subscription mutations across swarm agents.

---

## Strategic Fit & Marketplace Value

1. **Multi-Agent Governance Gap**:
   Terminal multiplexers give agents parallel execution speed, but multiply operational risk. ThumbGate acts as the central firewall gating every pane's tool calls.

2. **Zero-Latency Local Interception**:
   Runs locally via standard stdio MCP and shell hook events—zero third-party API dependencies or cloud latency.

3. **Herdr Marketplace Package**:
   Installable directly into Herdr via the plugin registry (`herdr plugin install thumbgate-approvals`).

---

## Installation & Setup

### 1. Install the Plugin in Herdr
```bash
herdr plugin install thumbgate-approvals
```

### 2. Configure Herdr Workspace Settings (`~/.herdr/config.json` or project `.herdr.json`)
```json
{
  "plugins": {
    "thumbgate-approvals": {
      "enabled": true,
      "mode": "enforce",
      "mcpServer": "npx --yes --package thumbgate@latest thumbgate serve",
      "gates": ["spend-guard", "protected-files", "workflow-sentinel"]
    }
  }
}
```

### 3. Verify Operational Integrity
```bash
npx thumbgate doctor
```

---

## Features & Architecture

```
┌───────────────────────────────────────────────────────────┐
│                     HERDR MULTIPLEXER                     │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────┐  │
│  │ Pane 1: Claude  │ │ Pane 2: Codex   │ │ Pane 3: Amp │  │
│  └────────┬────────┘ └────────┬────────┘ └──────┬──────┘  │
└───────────┼───────────────────┼─────────────────┼─────────┘
            │                   │                 │
            ▼                   ▼                 ▼
   ┌─────────────────────────────────────────────────────┐
   │        THUMBGATE APPROVALS PLUGIN FOR HERDR         │
   │  • PreToolUse / PreCommand Interception             │
   │  • Cross-Pane Prevention Rule Engine                │
   │  • Economic Spend Guard & Financial Ledger          │
   └──────────────────────────┬──────────────────────────┘
                              │
                              ▼
           ┌─────────────────────────────────────┐
           │ APPROVED / BLOCKED / ESCALATE DECISION│
           └─────────────────────────────────────┘
```

- **Manifest**: [`adapters/herdr/herdr-plugin.json`](file:///Users/igorganapolsky/workspace/git/igor/ThumbGate/adapters/herdr/herdr-plugin.json)
- **Adapter**: [`adapters/herdr/herdr-approvals-adapter.js`](file:///Users/igorganapolsky/workspace/git/igor/ThumbGate/adapters/herdr/herdr-approvals-adapter.js)
- **MCP Profile**: [`adapters/herdr/.mcp.json`](file:///Users/igorganapolsky/workspace/git/igor/ThumbGate/adapters/herdr/.mcp.json)
