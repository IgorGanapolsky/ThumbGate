# MCP Directory Submission Guide

> Research note: external repo stars, directory size, and community reach numbers in this file are time-bound research snapshots, not current product proof. Use `docs/COMMERCIAL_TRUTH.md` for current traction language.

**Package:** `mcp-memory-gateway` (npm)
**GitHub:** https://github.com/IgorGanapolsky/thumbgate
**Registry name:** `io.github.IgorGanapolsky/mcp-memory-gateway`
**Already listed:** [registry.modelcontextprotocol.io](https://registry.modelcontextprotocol.io)

---

## 1. Glama.ai — https://glama.ai/mcp/servers

**Status:** CONTACT INITIATED (March 19, 2026)

**How it works:** Glama automatically indexes MCP servers from GitHub and npm.
 It crawls repositories that contain MCP server metadata and ranks them by security, compatibility, and ease of use. There is no explicit "submit" form — servers appear once indexed.

**How to get listed:**
1. Ensure your GitHub repo has proper MCP metadata in `package.json` (name, description, repository URL, keywords).
2. Ensure your README clearly describes the server's MCP tools and capabilities.
3. Being listed on the official MCP Registry (which we already are) accelerates Glama discovery.
4. If the server does not appear after a few days, reach out via the Glama Discord community for manual review.

**Requirements:**
- Public GitHub repository
- Clear README with tool descriptions
- Valid `package.json` with `repository` field
- MCP-compatible server implementation

**URL pattern once listed:** `https://glama.ai/mcp/servers/@IgorGanapolsky/mcp-memory-gateway`

---

## 2. Smithery.ai — https://smithery.ai

**Status:** NOT YET LISTED

**How it works:** Smithery requires a `smithery.yaml` config file in your repo root and publishing via their web UI or CLI.

**How to get listed:**

### Option A: Web UI (simplest)
1. Go to https://smithery.ai/new
2. Sign in with GitHub
3. Provide your GitHub repo URL: `https://github.com/IgorGanapolsky/thumbgate`
4. Follow the guided setup

### Option B: CLI
1. Install: `npm i -g @smithery/cli`
2. Publish: `smithery mcp publish "https://github.com/IgorGanapolsky/thumbgate" -n IgorGanapolsky/mcp-memory-gateway`

### Required: Add `smithery.yaml` to repo root

```yaml
# smithery.yaml
startCommand:
  type: "stdio"
  configSchema:
    type: "object"
    properties:
      mcpProfile:
        type: "string"
        description: "MCP profile to use (default, essential, commerce, readonly, dispatch, locked)"
        default: "default"
    required: []
  commandFunction:
    command: "npx"
    args:
      - "-y"
      - "mcp-memory-gateway"
```

**Requirements:**
- `smithery.yaml` in repo root
- Public GitHub repository
- Node.js 18+ compatible

---

## 3. MCPcat.io — https://mcpcat.io

**Status:** N/A — NOT A DIRECTORY

**What it actually is:** MCPcat is an **analytics and debugging platform** for MCP server owners, not a server directory. It provides:
- Session replay for MCP tool calls
- Error tracking and performance monitoring
- Usage analytics

**Action:** No submission needed. However, we could integrate their SDK for analytics:
```bash
npm install @mcpcat/sdk
```
This would give us usage telemetry, which is useful but orthogonal to directory listing.

---

## 4. mcp.so — https://mcp.so

**Status:** NOT YET LISTED

**How it works:** mcp.so is powered by the `chatmcp/mcpso` GitHub repository. Submission is done by commenting on a pinned GitHub issue.

**How to get listed:**

### Step 1: Comment on the submission issue
Go to: https://github.com/chatmcp/mcpso/issues/1

Leave a comment with:
```
**mcp-memory-gateway**
https://github.com/IgorGanapolsky/thumbgate

feedback-to-enforcement pipeline for AI agents. Capture feedback, block repeated mistakes, export DPO training data.
 Compatible with Claude, GPT-4, Gemini, and multi-agent systems.

- npm: https://www.npmjs.com/package/mcp-memory-gateway
- Transport: stdio
- Runtime: Node.js
```

### Alternative: GitHub Discussions
You can also post in https://github.com/chatmcp/mcpso/discussions/categories/mcp-servers

**Requirements:**
- Public GitHub repository
- Clear description
- Working MCP server

---

## 5. Awesome MCP Servers Lists (GitHub)

There are three major lists. Submit to all of them.

### 5a. punkpeye/awesome-mcp-servers (largest GitHub discovery surface in March 2026 research)
**URL:** https://github.com/punkpeye/awesome-mcp-servers
**Contributing guide:** https://github.com/punkpeye/awesome-mcp-servers/blob/main/CONTRIBUTING.md

**How to submit:**
1. Fork the repo
2. Edit `README.md`
3. Add entry under the appropriate category (likely "AI/LLM Integration" or "Data & Analytics")
4. Format: `- [mcp-memory-gateway](https://github.com/IgorGanapolsky/thumbgate) - Pre-action gates that physically block AI coding agents from repeating known mistakes. Captures feedback, auto-promotes failures into prevention rules, and enforces them via PreToolUse hooks.`
5. Submit PR with title: `Add mcp-memory-gateway`

### 5b. appcypher/awesome-mcp-servers (well-established)
**URL:** https://github.com/appcypher/awesome-mcp-servers

**How to submit:**
1. Fork the repo
2. Edit `README.md`
3. Add entry under appropriate category
4. Format: `- **[mcp-memory-gateway](https://github.com/IgorGanapolsky/thumbgate)** - Pre-action gates that physically block AI coding agents from repeating known mistakes. Captures feedback, auto-promotes failures into prevention rules, and enforces them via PreToolUse hooks. (Node.js)`
5. Submit PR

### 5c. wong2/awesome-mcp-servers → mcpservers.org
**URL:** https://github.com/wong2/awesome-mcp-servers
**Note:** This repo does NOT accept PRs. Instead, submit via their website.

**How to submit:**
1. Go to https://mcpservers.org/submit
2. Fill in the form with server details

---

## Submission Priority

| # | Directory | Method | Effort | Reach |
|---|-----------|--------|--------|-------|
| 1 | punkpeye/awesome-mcp-servers | GitHub PR | Low | Very High (large GitHub discovery surface) |
| 2 | mcp.so | GitHub issue comment | Very Low | High (large directory footprint) |
| 3 | Smithery.ai | Web UI + smithery.yaml | Medium | High |
| 4 | appcypher/awesome-mcp-servers | GitHub PR | Low | Medium |
| 5 | mcpservers.org | Web form | Very Low | Medium |
| 6 | Glama.ai | Automatic (wait for indexing) | None | High |

---

## Ready-to-Use PR Content for Awesome Lists

### Entry text (punkpeye format):
```markdown
- [mcp-memory-gateway](https://github.com/IgorGanapolsky/thumbgate) - Pre-action gates that physically block AI coding agents from repeating known mistakes. Captures feedback, auto-promotes failures into prevention rules, and enforces them via PreToolUse hooks.
```

### Entry text (appcypher format):
```markdown
- **[mcp-memory-gateway](https://github.com/IgorGanapolsky/thumbgate)** - Pre-action gates that physically block AI coding agents from repeating known mistakes. Captures feedback, auto-promotes failures into prevention rules, and enforces them via PreToolUse hooks. (Node.js)
```

### mcp.so comment (ready to paste):
```
**mcp-memory-gateway**
https://github.com/IgorGanapolsky/thumbgate

Pre-action gates that physically block AI coding agents from repeating known mistakes. Captures feedback, auto-promotes failures into prevention rules, and enforces them via PreToolUse hooks.

- npm: https://www.npmjs.com/package/mcp-memory-gateway
- MCP Registry: https://registry.modelcontextprotocol.io
- Transport: stdio
- Runtime: Node.js
```
