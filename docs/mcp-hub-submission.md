---
title: Claude MCP Hub Submission — RLHF Feedback Loop
created: 2026-03-04T00:00:00Z
updated: 2026-03-04T00:00:00Z
status: ready-to-submit
---

# Claude MCP Hub Submission: RLHF Feedback Loop

Submit to: https://github.com/modelcontextprotocol/servers (official MCP servers list)
Also submit to: https://mcp.so (community MCP directory)

---

## Server Name

```
rlhf-feedback-loop
```

---

## Short Description (one line)

```
Capture thumbs-up/down feedback from Claude coding sessions, enforce schema quality, prevent repeated failures, and export DPO training pairs.
```

---

## Full Description

```
RLHF Feedback Loop gives Claude Code (and any MCP-compatible client) a production-grade feedback capture loop.

Every interaction can be rated with a thumbs-up or thumbs-down signal plus rich context: rubric scores, guardrails, file paths, error types, and outcome categories. Repeated failures automatically generate prevention rules in CLAUDE.md format so Claude stops making the same mistakes.

The server exposes MCP tools for:
- Capturing feedback with schema validation
- Retrieving prevention rules generated from failure patterns
- Querying feedback summaries and statistics
- Exporting DPO preference pairs for offline fine-tuning

Works in local mode (zero config, no API key) or connected to the Cloud Pro hosted API.
```

---

## Install Command

### Option A: Local mode (OSS, no API key needed)

```bash
claude mcp add rlhf -- npx -y rlhf-feedback-loop serve
```

Optional manual config (`~/.claude/claude_desktop_config.json` or `.claude/settings.json`):

```json
{
  "mcpServers": {
    "rlhf-feedback-loop": {
      "command": "node",
      "args": ["/path/to/rlhf-feedback-loop/adapters/mcp/server-stdio.js"],
      "env": {
        "RLHF_BASE_URL": "http://localhost:8787"
      }
    }
  }
}
```

### Option B: Cloud Pro (hosted API)

```json
{
  "mcpServers": {
    "rlhf-feedback-loop": {
      "command": "node",
      "args": ["/path/to/rlhf-feedback-loop/adapters/mcp/server-stdio.js"],
      "env": {
        "RLHF_BASE_URL": "https://rlhf-feedback-loop-710216278770.us-central1.run.app",
        "RLHF_API_KEY": "rlhf_YOUR_KEY_HERE"
      }
    }
  }
}
```

Get your API key at: https://buy.stripe.com/bJe14neyU4r4f0leOD3sI02 ($49/mo Cloud Pro)
Verification evidence: https://github.com/IgorGanapolsky/rlhf-feedback-loop/blob/main/docs/VERIFICATION_EVIDENCE.md

---

## MCP Tools Exposed

| Tool Name | Description |
|-----------|-------------|
| `capture_feedback` | Capture a thumbs-up or thumbs-down signal with context, rubric scores, and guardrails |
| `get_feedback_summary` | Retrieve aggregated feedback statistics and patterns |
| `get_prevention_rules` | Retrieve prevention rules auto-generated from repeated failure patterns |
| `export_dpo_pairs` | Export feedback as DPO preference pairs for fine-tuning |
| `get_feedback_stats` | Get per-category Thompson Sampling posteriors |
| `validate_feedback` | Validate a feedback entry against the RLHF schema without capturing |

---

## Capabilities

- **Feedback Capture**: Structured up/down signals with rubric scores, guardrails, tags, file paths
- **Schema Validation**: Every entry is validated before promotion to memory
- **Prevention Rules**: Repeated failures auto-generate CLAUDE.md-compatible prevention rules
- **Thompson Sampling**: Per-category alpha/beta posteriors with exponential time-decay
- **Sequence Tracking**: Sliding window (N=10) feedback sequences per category
- **Diversity Tracking**: Per-domain coverage scores and diversity metrics
- **DPO Export**: PyTorch-ready preference pairs for offline fine-tuning
- **Vector Search**: LanceDB semantic similarity search over feedback history
- **Budget Guard**: Hard spend cap enforcement on every API operation
- **Context Packs**: Bounded retrieval for active task contexts
- **Self-Healing**: Automatic detection and remediation of config drift

---

## Transport

- **stdio** (primary): `adapters/mcp/server-stdio.js` — works with Claude Code desktop and CLI
- **HTTP** (secondary): `src/api/server.js` — REST API (`POST /v1/feedback/capture`, `GET /v1/feedback/summary`, `POST /v1/dpo/export`)

---

## Repository

```
https://github.com/IgorGanapolsky/rlhf-feedback-loop
```

---

## npm Package

```
https://www.npmjs.com/package/rlhf-feedback-loop
```

Install:
```bash
npm install rlhf-feedback-loop
```

---

## License

MIT

---

## Tags / Categories

- `rlhf`
- `feedback`
- `ai-training`
- `dpo`
- `coding-agent`
- `prevention-rules`
- `productivity`
- `claude-code`

---

## Version

0.6.6

---

## Test Count

314+ passing tests in CI. No placeholder results.

```bash
npm test
```

---

## Submission Checklist (modelcontextprotocol/servers PR)

- [ ] Fork https://github.com/modelcontextprotocol/servers
- [ ] Add entry to `README.md` under **Community Servers** in alphabetical order:
  ```markdown
  - **[RLHF Feedback Loop](https://github.com/IgorGanapolsky/rlhf-feedback-loop)** — Capture feedback from AI coding agents, prevent repeated mistakes, export DPO training pairs. Works with Claude Code, ChatGPT, Gemini, Codex, and Amp.
  ```
- [ ] Open PR titled: `Add rlhf-feedback-loop community server`
- [ ] Verify CI passes on the PR

## Submission Checklist (mcp.so)

- [ ] Go to https://mcp.so/submit
- [ ] Paste GitHub URL: `https://github.com/IgorGanapolsky/rlhf-feedback-loop`
- [ ] Verify auto-populated fields (name, description, tools)
- [ ] Add tags: `rlhf`, `feedback`, `dpo`, `coding-agent`
- [ ] Submit
