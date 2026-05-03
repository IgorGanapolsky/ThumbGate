# MCP Directory Submission Guide

> Research note: external repo stars, directory size, and community reach numbers in this file are time-bound research snapshots, not current product proof. Use `docs/COMMERCIAL_TRUTH.md` for current traction language.
>
> Live operator status is tracked in `docs/marketing/mcp-directory-revenue-pack.md` and `docs/marketing/mcp-directory-operator-queue.csv`. This guide is for submission mechanics plus repair copy, not for stale status claims.

**Package:** `thumbgate` (npm)
**GitHub:** https://github.com/IgorGanapolsky/ThumbGate
**Registry name:** `io.github.IgorGanapolsky/ThumbGate`
**Already listed:** [registry.modelcontextprotocol.io](https://registry.modelcontextprotocol.io), [mcp.so/server/thumbgate/IgorGanapolsky](https://mcp.so/server/thumbgate/IgorGanapolsky)

## Live status snapshot (checked 2026-04-30)

- MCP.so: canonical ThumbGate listing is live at `thumbgate/IgorGanapolsky`.
- Glama: canonical `IgorGanapolsky/ThumbGate` listing resolves, but buyer-facing copy still leaks the old memory-gateway description and RLHF-prefixed config names.
- Smithery: search still resolves to `rlhf-loop/thumbgate`; the canonical ThumbGate namespace is not live yet.
- punkpeye/awesome-mcp-servers: entry exists but still points to `IgorGanapolsky/mcp-memory-gateway`.
- appcypher/awesome-mcp-servers: no current ThumbGate entry found.

---

## 1. Glama.ai — https://glama.ai/mcp/servers

**Status:** LIVE CANONICAL LISTING, COPY REPAIR STILL NEEDED (checked 2026-04-30)

**What changed:** search for `thumbgate` now resolves to `https://glama.ai/mcp/servers/IgorGanapolsky/ThumbGate`, which fixes the old slug problem. The listing still exposes legacy copy: the plain-text description is about a memory gateway and the config hints still show RLHF-prefixed env names. Treat Glama as partially repaired, not done.

**How it works:** Glama automatically indexes MCP servers from GitHub and npm.
It crawls repositories that contain MCP server metadata and ranks them by security, compatibility, and ease of use. There is no explicit "submit" form, so the repair path is listing metadata cleanup rather than a fresh submission.

**How to get listed:**
1. Ensure your GitHub repo has proper MCP metadata in `package.json` (name, description, repository URL, keywords).
2. Ensure your README clearly describes the server's MCP tools and capabilities.
3. Being listed on the official MCP Registry and MCP.so accelerates Glama discovery.
4. If the listing copy drifts from ThumbGate-only naming, request a metadata refresh through Glama support or community channels.

**Requirements:**
- Public GitHub repository
- Clear README with tool descriptions
- Valid `package.json` with `repository` field
- MCP-compatible server implementation

**Current listing URL:** `https://glama.ai/mcp/servers/IgorGanapolsky/ThumbGate`

---

## 2. Smithery.ai — https://smithery.ai

**Status:** LEGACY LISTING EXISTS, CANONICAL NAMESPACE NOT LIVE (checked 2026-04-30)

**What changed:** Smithery search now returns `rlhf-loop/thumbgate` with `0 connections`. That means there is a live legacy namespace result, but it is not the canonical ThumbGate ownership path yet.

**How it works:** Smithery requires a `smithery.yaml` config file in your repo root and publishing via their web UI or CLI.

**How to get listed:**

### Option A: Web UI (simplest)
1. Go to https://smithery.ai/new
2. Sign in with GitHub
3. Provide your GitHub repo URL: `https://github.com/IgorGanapolsky/ThumbGate`
4. Follow the guided setup

### Option B: CLI
1. Install: `npm i -g @smithery/cli`
2. Publish: `smithery mcp publish "https://github.com/IgorGanapolsky/ThumbGate" -n IgorGanapolsky/ThumbGate`

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
      - "thumbgate"
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

**Status:** LIVE CANONICAL LISTING (checked 2026-04-30)

**What changed:** the canonical listing is already live at `https://mcp.so/server/thumbgate/IgorGanapolsky`, so use MCP.so as the naming and copy backstop when repairing other directories.

**How it works:** mcp.so is powered by the `chatmcp/mcpso` GitHub repository. New servers can still be submitted by commenting on a pinned GitHub issue.

**How to get listed:**

### Step 1: Use the current live listing as the canonical reference
Verify: https://mcp.so/server/thumbgate/IgorGanapolsky

### Step 2: For new metadata changes or a missing listing, comment on the submission issue
Go to: https://github.com/chatmcp/mcpso/issues/1

Leave a comment with:
```
**thumbgate**
https://github.com/IgorGanapolsky/ThumbGate

feedback-to-enforcement pipeline for AI agents. Capture feedback, block repeated mistakes, export DPO training data.
 Compatible with Claude, GPT-4, Gemini, and multi-agent systems.

- npm: https://www.npmjs.com/package/thumbgate
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
**Current state:** live entry still points to `IgorGanapolsky/mcp-memory-gateway`, so this is a repair PR, not a net-new submission.

**How to submit:**
1. Fork the repo
2. Edit `README.md`
3. Add entry under the appropriate category (likely "AI/LLM Integration" or "Data & Analytics")
4. Format: `- [thumbgate](https://github.com/IgorGanapolsky/ThumbGate) - Pre-action checks that physically block AI coding agents from repeating known mistakes. Captures feedback, auto-promotes failures into prevention rules, and enforces them via PreToolUse hooks.`
5. Submit PR with title: `Add thumbgate`

### 5b. appcypher/awesome-mcp-servers (well-established)
**URL:** https://github.com/appcypher/awesome-mcp-servers
**Current state:** no current ThumbGate entry found in `main`, so this is still a clean add.

**How to submit:**
1. Fork the repo
2. Edit `README.md`
3. Add entry under appropriate category
4. Format: `- **[thumbgate](https://github.com/IgorGanapolsky/ThumbGate)** - Pre-action checks that physically block AI coding agents from repeating known mistakes. Captures feedback, auto-promotes failures into prevention rules, and enforces them via PreToolUse hooks. (Node.js)`
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
| 1 | punkpeye/awesome-mcp-servers | GitHub PR repair | Low | Very High (large GitHub discovery surface) |
| 2 | Glama.ai | Listing metadata repair | Low | High |
| 3 | Smithery.ai | Namespace repair + publish flow | Medium | High |
| 4 | appcypher/awesome-mcp-servers | GitHub PR add | Low | Medium |
| 5 | mcp.so | Canonical reference / metadata refresh only | Very Low | High |
| 6 | mcpservers.org | Web form | Very Low | Medium |

---

## Ready-to-Use PR Content for Awesome Lists

### Entry text (punkpeye format):
```markdown
- [thumbgate](https://github.com/IgorGanapolsky/ThumbGate) - Pre-action checks that physically block AI coding agents from repeating known mistakes. Captures feedback, auto-promotes failures into prevention rules, and enforces them via PreToolUse hooks.
```

### Entry text (appcypher format):
```markdown
- **[thumbgate](https://github.com/IgorGanapolsky/ThumbGate)** - Pre-action checks that physically block AI coding agents from repeating known mistakes. Captures feedback, auto-promotes failures into prevention rules, and enforces them via PreToolUse hooks. (Node.js)
```

### mcp.so comment (ready to paste):
```
**thumbgate**
https://github.com/IgorGanapolsky/ThumbGate

Pre-action checks that physically block AI coding agents from repeating known mistakes. Captures feedback, auto-promotes failures into prevention rules, and enforces them via PreToolUse hooks.

- npm: https://www.npmjs.com/package/thumbgate
- MCP Registry: https://registry.modelcontextprotocol.io
- Transport: stdio
- Runtime: Node.js
```
