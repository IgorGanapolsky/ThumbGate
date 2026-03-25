# ThumbGate for Claude Desktop

`mcp-memory-gateway` gives Claude Desktop a local-first **Reliability Gateway** and **Pre-Action Gates** for workflow hardening.

The extension path is useful when a team wants Claude Desktop to keep one workflow sharper over time without adding another orchestration layer. The MCP server captures explicit feedback, recalls past failures, promotes reusable prevention rules, and produces proof-backed rollout artifacts.

## Features

- Workflow hardening for Claude-first engineering and ops workflows
- Pre-Action Gates that block repeated mistakes before tool use
- Reliability memory and recall across long sessions
- Bounded context packs, provenance, and diagnostics
- DPO export and analytics bundle generation after runtime reliability lands
- Submission-ready MCPB packaging for Claude Desktop review and local installs

## Installation

### Local install today

Use the portable npm launcher:

```bash
claude mcp add rlhf -- npx -y mcp-memory-gateway serve
```

Or use the project bootstrap:

```bash
npx mcp-memory-gateway init
```

### Anthropic directory path

If Anthropic approves the listing, install from Claude Desktop via `Settings -> Extensions`.

Directory inclusion is an external review process. Do not claim listing or approval before it is real.

### MCPB bundle build

Maintainers can build the local Claude Desktop bundle directly from this repo:

```bash
npm run build:claude-mcpb
```

That command stages a clean bundle, installs production dependencies, packs a `.mcpb`, and validates it with Anthropic's official MCPB CLI.

## Configuration

The local OSS path needs no API key.

Optional hosted path:

```json
{
  "mcpServers": {
    "rlhf": {
      "command": "npx",
      "args": ["-y", "mcp-memory-gateway", "serve"],
      "env": {
        "RLHF_BASE_URL": "https://rlhf-feedback-loop-production.up.railway.app",
        "RLHF_API_KEY": "rlhf_YOUR_KEY_HERE"
      }
    }
  }
}
```

## Examples

### Example 1: PR review hardening

**User prompt:** "Review this PR and tell me if any blocker would stop merge."
**Expected behavior:**
- Claude Desktop inspects the workflow context instead of relying on one-shot memory
- The extension recalls prior blocker patterns when they exist
- The Pre-Action Gates can promote the missed blocker into a reusable gate

### Example 2: Code modernization workflow

**User prompt:** "Help me modernize this service, but keep the migration constraints and verification steps across sessions."
**Expected behavior:**
- Claude Desktop recalls prior migration notes and architecture constraints
- The extension keeps the context pack bounded instead of replaying full history
- Verification steps stay attached to the workflow across sessions

### Example 3: Internal ops or release workflow

**User prompt:** "Run the release checklist, capture what went wrong, and stop the same mistake next time."
**Expected behavior:**
- Claude Desktop records explicit operator feedback and proof artifacts
- The extension keeps the workflow history local-first and searchable
- Repeated release failures can be turned into prevention rules before the next run

## Privacy Policy

For complete privacy information, see: https://rlhf-feedback-loop-production.up.railway.app/privacy

### Data Collection

- Local installs store workflow memory, feedback entries, and proof artifacts in local project files.
- Optional hosted mode sends feedback and memory data to the configured `RLHF_BASE_URL`.
- Optional CLI telemetry is best-effort and can be disabled with `RLHF_NO_TELEMETRY=1`.
- We do not sell customer data; retention and deletion details live in the public privacy policy.

## Support

- GitHub Issues: https://github.com/IgorGanapolsky/mcp-memory-gateway/issues
- Security Advisories: https://github.com/IgorGanapolsky/mcp-memory-gateway/security
- Verification evidence: https://github.com/IgorGanapolsky/mcp-memory-gateway/blob/main/docs/VERIFICATION_EVIDENCE.md

## Notes For Submission

- Local Claude metadata lives in `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`.
- The MCPB bundle is built with `npm run build:claude-mcpb`.
- Anthropic directory requirements and the internal publish checklist live in `docs/CLAUDE_DESKTOP_EXTENSION.md`.
