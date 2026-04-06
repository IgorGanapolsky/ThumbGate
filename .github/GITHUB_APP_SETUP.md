# GitHub App Registration Guide

This document explains how to register the ThumbGate as a GitHub App (if needed for GitHub integration features).

## Quick Facts

- **What**: GitHub App manifest for ThumbGate
- **Where**: `.github/github-app-manifest.json`
- **When to use**: Only if building GitHub-native integrations (PR analysis, etc.)
- **Marketplace eligible**: No (MCP servers don't qualify for GitHub Marketplace)
- **Better option**: Submit to MCP Marketplace instead

---

## Manual Registration Steps

If you want to register this GitHub App:

### Option 1: Manifest Flow (Fastest)

1. Base64-encode the manifest:
```bash
cat .github/github-app-manifest.json | base64 -w 0
```

2. Create a shareable registration link:
```
https://github.com/apps/new?state=manifest&manifest=<paste-base64-here>
```

3. Anyone who clicks that link gets a pre-configured app registration with your settings

### Option 2: Manual Registration (Standard)

1. Go to: https://github.com/settings/apps/new
2. Fill in from manifest:
   - **GitHub App name**: ThumbGate
   - **Homepage URL**: https://thumbgate-production.up.railway.app
   - **Webhook URL**: https://thumbgate-production.up.railway.app/webhooks/github
   - **Webhook active**: ✓ Checked
   - **Redirect URL**: https://thumbgate-production.up.railway.app/github/callback
   - **Callback URLs**: (add both from manifest)
   - **Setup URL**: https://thumbgate-production.up.railway.app/setup
   - **Public app**: ✓ Checked
   - **Permissions**: See below
   - **Events**: See below

### Permissions (from manifest)

Set these to **read**:
- Contents
- Pull requests
- Issues
- Workflows

Keep everything else as **no access**.

### Events (from manifest)

Subscribe to:
- Pull request
- Issues
- Push
- Workflow run

## What You Get

After registration, GitHub generates:

1. **App ID** — Identify your app
2. **Private key** (PEM) — Sign requests to GitHub
3. **Client ID** — For OAuth flow
4. **Client secret** — OAuth authentication
5. **Webhook secret** — Validate webhook signatures

Store these securely (not in git):
```bash
# Example .env
GITHUB_APP_ID=12345
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..."
GITHUB_WEBHOOK_SECRET="whsec_..."
GITHUB_CLIENT_ID="Iv1.abc..."
GITHUB_CLIENT_SECRET="secret_xyz..."
```

## Implementation Notes

### Webhook Receiver

Your server needs a `POST /webhooks/github` endpoint that:
1. Validates signature using webhook secret
2. Routes events (pull_request, issues, push, workflow_run)
3. Calls ThumbGate to analyze feedback

Example:
```javascript
// src/webhooks/github.js
async function handleGitHubEvent(req, res) {
  const signature = req.headers['x-hub-signature-256'];

  // Validate signature
  if (!verifySignature(req.body, signature)) {
    return res.status(401).send('Unauthorized');
  }

  const event = req.headers['x-github-event'];
  const payload = req.body;

  // Route to ThumbGate
  switch (event) {
    case 'pull_request':
      await analyzePullRequest(payload);
      break;
    case 'issues':
      await analyzeIssue(payload);
      break;
    case 'workflow_run':
      await analyzeWorkflowRun(payload);
      break;
  }

  res.status(200).send('OK');
}
```

### OAuth Flow

Setup URL (`/setup`) should:
1. Collect user preferences
2. Store installation ID
3. Request user authorization if `request_oauth_on_install: true`

## Testing

### Local Development

Use ngrok or localtunnel to expose local server:
```bash
# In separate terminal
npx ngrok http 3000

# Update GitHub App settings webhook URL to:
# https://abc123.ngrok-free.app/webhooks/github
```

### Using GitHub CLI

Authenticate as the app:
```bash
# Once registered, get your app credentials
gh auth login

# Test API calls as the app
gh api --method POST /repos/{owner}/{repo}/issues \
  -f title="Test" \
  -f body="Automated test"
```

## FAQ

**Q: Do I need to register this to submit to GitHub Marketplace?**
A: No. GitHub Marketplace only lists GitHub Actions and already-registered GitHub Apps. You'd register the app separately.

**Q: Can MCP servers go on GitHub Marketplace?**
A: No. GitHub Marketplace is for GitHub Actions and GitHub Apps only.

**Q: Should I build a GitHub App wrapper?**
A: Only if you need GitHub-native features (PR comments, issue updates, etc.). For pure MCP distribution, submit to Cline MCP Marketplace instead.

**Q: Is the manifest secure?**
A: The manifest is public and doesn't contain secrets. All credentials are generated after registration and should be kept private.

---

## Decision Tree

```
Do you want GitHub-native integration?
├─ YES → Register GitHub App using this manifest
│        └─ Also submit MCP server to MCP Marketplace
│
└─ NO → Skip GitHub App, submit MCP server directly
         └─ Go to: https://github.com/cline/mcp-marketplace
```

---

## References

- [GitHub App Manifest Docs](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)
- [GitHub App Authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app)
- [Webhook Signature Verification](https://docs.github.com/en/developers/webhooks-and-events/webhooks/securing-your-webhooks)
- [MCP Marketplace (Better Option)](https://github.com/cline/mcp-marketplace)

