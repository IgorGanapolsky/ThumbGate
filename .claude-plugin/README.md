# ThumbGate for Claude Desktop

**Give thumbs up 👍 or thumbs down 👎 on any agent action. ThumbGate captures it, runs History-aware lesson distillation across up to 8 prior recorded entries, and blocks the pattern from repeating. Just type "thumbs up" or "thumbs down" in the chat.**

## Try it now

1. Install ThumbGate
2. Start a Claude Desktop session
3. When the agent does something wrong, type: **thumbs down**
4. ThumbGate captures the mistake, distills a lesson, and creates a prevention rule
5. Next session: the agent physically cannot repeat that mistake

That's it. One thumbs-down, never again.

## What it does

- **👎 Thumbs down** → captures the mistake → distills a lesson → auto-promotes to a prevention rule → PreToolUse hook blocks the pattern before execution
- **👍 Thumbs up** → reinforces good patterns → agent starts preferring your approved flows without re-explaining them each session
- **33 pre-action checks** → block destructive actions (force-push, mass delete, destructive SQL) before they execute
- **Budget enforcement** → action count + time limits prevent runaway sessions
- **Self-protection** → agent cannot disable its own governance
- **Compliance tags** → NIST, SOC2, OWASP, CWE on prevention rules for enterprise teams
- **Shared team enforcement** → one engineer's thumbs-down protects the whole team
- **60-second follow-up** → feedback can link to a prior mistake with `relatedFeedbackId` so delayed corrections still become useful prevention rules

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

### Example 1: Block force-push

```
You: "Push my changes to main"
Claude: [tries git push --force]
ThumbGate: ⛔ Blocked — "no-force-push" (confidence: 0.94)
You: Never had to correct it again.
```

### Example 2: Thumbs-down on bad action

```
You: "thumbs down"
ThumbGate: 👎 Captured. History-aware lesson distillation from up to 8 prior recorded entries...
           Lesson: "Agent edited production config without approval"
           Follow-up window: 60-second follow-up can attach relatedFeedbackId
           Rule auto-promoted. Will block matching actions in future sessions.
```

### Example 3: Thumbs-up reinforces good patterns

```
You: "thumbs up"
ThumbGate: 👍 Recorded. Reinforcing: "Agent used feature branch + PR workflow"
           Agent will prefer this pattern in future sessions.
```

### Example 4: Budget enforcement

```
[Agent hits 500 actions in strict mode]
ThumbGate: ⛔ Budget exceeded: 501/500 actions used. Session budget exhausted.
```

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
