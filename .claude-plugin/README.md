# ThumbGate for Claude Desktop

**Give thumbs up 👍 or thumbs down 👎 on an agent action. ThumbGate captures the context, distills a local lesson, and can promote repeated concrete failures into reviewable PreToolUse rules.**

For vague feedback, the current Claude hook can use up to 8 prior recorded entries to propose a reviewable lesson.

## Try it now

1. Install ThumbGate
2. Start a Claude Desktop session
3. When the agent does something wrong, type: **thumbs down**
4. ThumbGate captures the mistake and distills a reviewable local lesson
5. Repeated concrete failures can promote a prevention rule; strict policy can deny the next matching action

Critical built-in floors are different: detected secret exfiltration and supported unapproved financial mutations deny before execution without relying on warn-by-default policy.

## If a gate over-fires

ThumbGate should protect the operator, not trap the operator. If a noisy rule blocks the hook/settings change you need to recover a Claude session, use the short-lived break-glass command:

```bash
npx thumbgate break-glass --reason="ThumbGate over-fired and blocked operator recovery"
```

That grants up to 5 minutes for recovery edits to `.claude/settings.local.json`, `.claude/settings.json`, `.codex/config.toml`, and matching nested workspace files. It also satisfies the temporary `pr_create_allowed` and `pr_threads_checked` gates used to recover a stuck PR flow.

It does not disable the destructive-action protections: force pushes, protected-branch pushes, broad `rm -rf`, unsafe `chmod`, package publishes/releases, local-only remote side effects, arbitrary protected docs, and credentials stay gated.

Verify the state before continuing:

```bash
npx thumbgate break-glass --reason="verify recovery path" --json
npx thumbgate doctor
```

After changing MCP or hook settings, restart Claude Desktop or Claude Code so it reloads `.mcp.json` and local settings.

## What it does

- **👎 Thumbs down** → captures the mistake → distills a lesson → repeated concrete failures can promote a prevention rule
- **👍 Thumbs up** → records an accepted outcome for local recall and evaluation
- **Pre-action checks** → flag risky actions and deny when strict or unconditional policy requires it
- **Financial hard floor** → requires an explicit budget plus an exact-action requisition approved by an independently authenticated human reviewer
- **Budget tracking** → records action count and session time; enforcement is an explicit operator choice
- **Self-protection** → hard-gates direct edits to configured hook and governance files, with audited repair paths
- **Compliance tags** → NIST, SOC2, OWASP, CWE on prevention rules for enterprise teams
- **Local-first enforcement** → lessons and receipts remain reviewable in the active project; hosted team sync is not general availability
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

Full setup guide: https://thumbgate-production.up.railway.app/guide

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
- Full setup guide: https://thumbgate-production.up.railway.app/guide
- Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
- Product Hunt: https://www.producthunt.com/products/thumbgate

## Notes For Submission

- Local Claude metadata lives in `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`.
- The MCPB bundle is built with `npm run build:claude-mcpb`.
- The review packet zip is built with `npm run build:claude-review-zip`.
- Anthropic directory requirements and the internal publish checklist live in `docs/CLAUDE_DESKTOP_EXTENSION.md`.
