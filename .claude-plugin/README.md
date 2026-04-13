# ThumbGate for Claude Desktop

`thumbgate` gives Claude Desktop a local-first **Reliability Gateway** and **Pre-Action Gates** for workflow hardening.

The extension path is useful when a team wants Claude Desktop to keep one workflow sharper over time without adding another orchestration layer. The MCP server captures explicit feedback, recalls past failures, distills lessons from up to 8 prior recorded entries when the current Claude hook only gets a vague thumbs-down, promotes reusable prevention rules, and produces proof-backed rollout artifacts.

## Features

- Workflow hardening for Claude-first engineering and ops workflows
- Pre-Action Gates that block repeated mistakes before tool use
- History-aware lesson distillation from up to 8 prior recorded entries and failed tool calls in the current Claude auto-capture path
- Reliability memory and recall across long sessions
- Bounded context packs, provenance, and diagnostics
- DPO export and analytics bundle generation after runtime reliability lands
- Submission-ready MCPB packaging for Claude Desktop review and local installs

## Installation

### Local install today

Use the portable npm launcher:

```bash
claude mcp add thumbgate -- npx --yes --package thumbgate thumbgate serve
```

Or use the project bootstrap:

```bash
npx thumbgate init
```

### Direct bundle download

Download the latest packaged Claude Desktop bundle from GitHub Releases:

https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-claude-desktop.mcpb

That bundle is built from the same `.claude-plugin` metadata in this repo and is meant for people who want a ready-to-install artifact instead of building locally.

### Review packet zip

Anthropic's submission flow may ask for a GitHub link or a zip that preserves the plugin folder structure. The review-ready source zip lives on GitHub Releases:

https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-claude-plugin-review.zip

### Anthropic directory path

If Anthropic approves the listing, install from Claude Desktop via `Settings -> Extensions`.

Directory inclusion is an external review process. Do not claim listing or approval before it is real.

Submission forms:

- https://claude.ai/settings/plugins/submit
- https://platform.claude.com/plugins/submit

### Repo marketplace while review is pending

Claude Code users do not need to wait for the official directory. Anthropic's plugin docs allow adding a repository marketplace directly when the repo contains `.claude-plugin/marketplace.json`.

Inside Claude Code, run:

```text
/plugin marketplace add IgorGanapolsky/ThumbGate
/plugin install thumbgate@thumbgate-marketplace
```

That uses the marketplace metadata already published in this repository while Anthropic reviews the official directory submission.

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
    "thumbgate": {
      "command": "npx",
      "args": ["--yes", "--package", "thumbgate", "thumbgate", "serve"],
      "env": {
        "THUMBGATE_BASE_URL": "https://thumbgate-production.up.railway.app",
        "THUMBGATE_API_KEY": "tg_YOUR_KEY_HERE"
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

### Example 4: Bare thumbs-down with automatic lesson proposal

**User prompt:** "👎 That was wrong."
**Expected behavior:**
- Claude Desktop can pass up to 8 prior recorded entries and the failed tool call into `capture_feedback`
- ThumbGate distills a proposed `whatWentWrong` and `whatToChange` from recent history
- A linked 60-second follow-up session can refine the same feedback record with `relatedFeedbackId`

## Privacy Policy

For complete privacy information, see: https://thumbgate-production.up.railway.app/privacy

### Data Collection

- Local installs store workflow memory, feedback entries, and proof artifacts in local project files.
- Optional hosted mode sends feedback and memory data to the configured `THUMBGATE_BASE_URL`.
- Optional CLI telemetry is best-effort and can be disabled with `THUMBGATE_NO_TELEMETRY=1`.
- We do not sell customer data; retention and deletion details live in the public privacy policy.

## Support

- GitHub Issues: https://github.com/IgorGanapolsky/ThumbGate/issues
- Security Advisories: https://github.com/IgorGanapolsky/ThumbGate/security
- Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
- Product Hunt: https://www.producthunt.com/products/thumbgate

## Notes For Submission

- Local Claude metadata lives in `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`.
- The MCPB bundle is built with `npm run build:claude-mcpb`.
- The review packet zip is built with `npm run build:claude-review-zip`.
- Anthropic directory requirements and the internal publish checklist live in `docs/CLAUDE_DESKTOP_EXTENSION.md`.
