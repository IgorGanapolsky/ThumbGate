# MCP Autonomous Setup Checklist

> **Goal:** Give Claude full send-email + GitHub autonomy — zero handoffs.

## Prerequisites

- [ ] Claude Desktop installed
- [ ] Node.js 18+ with `npx` available
- [ ] Google OAuth credentials (for Gmail)
- [ ] GitHub Personal Access Token (fine-grained, scoped to your repos)

---

## Step 1: Gmail MCP Server (Send Capability)

Anthropic's built-in Gmail connector is **read-only** — no send tool exists.
Install the community server that adds full send:

```bash
# 1. Create credentials directory
mkdir -p ~/.gmail-mcp

# 2. Place your Google OAuth client credentials file there
#    (Download from Google Cloud Console → APIs & Services → Credentials)
cp /path/to/credentials.json ~/.gmail-mcp/credentials.json

# 3. Run one-time auth flow
npx @gongrzhe/server-gmail-autoauth-mcp auth
```

**Capabilities unlocked:** send email, attachments, CC/BCC, HTML formatting.

---

## Step 2: GitHub MCP Server (PR/Issue/Push Autonomy)

```bash
# Generate a fine-grained PAT at https://github.com/settings/tokens?type=beta
# Scopes needed: repo (full), issues (read/write), pull_requests (read/write)
```

---

## Step 3: Configure Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gmail": {
      "command": "npx",
      "args": ["@gongrzhe/server-gmail-autoauth-mcp"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "<YOUR_FRESH_TOKEN>"
      }
    }
  }
}
```

> ⚠️ **Security:** Never commit this file. The token lives only in Claude Desktop's local config.

---

## Step 4: Restart & Verify

- [ ] Quit Claude Desktop completely (Cmd+Q, not just close window)
- [ ] Relaunch Claude Desktop
- [ ] Verify MCP servers appear in Claude Desktop settings → MCP
- [ ] Test Gmail: ask Claude to "send a test email to yourself"
- [ ] Test GitHub: ask Claude to "list open PRs on igorganapolsky/mcp-memory-gateway"

---

## Step 5: Revoke Old Tokens

- [ ] Revoke any previously exposed GitHub PATs at https://github.com/settings/tokens
- [ ] Rotate Google OAuth credentials if previously leaked

---

## What This Enables

| Capability | Before | After |
|---|---|---|
| Read email | ✅ | ✅ |
| Send email | ❌ (draft only) | ✅ |
| Create GitHub PRs | ❌ (CLI only) | ✅ |
| Merge PRs | ❌ | ✅ |
| Create issues | ❌ | ✅ |
| Push code | ❌ | ✅ |

**Total setup time:** ~5 minutes.
