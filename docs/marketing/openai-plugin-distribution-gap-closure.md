# OpenAI Plugin Distribution Gap Closure

Date: 2026-06-03

This is the owned-channel checklist for publishing and advertising ThumbGate's OpenAI-facing surfaces without overstating marketplace status.

## Current Owned Surfaces

| Surface | URL | Status | Evidence |
| --- | --- | --- | --- |
| ChatGPT App / GPT Action page | https://thumbgate.ai/chatgpt-app | Shipped in repo | Public page, sitemap entry, README link, package inclusion |
| Live ThumbGate GPT | https://thumbgate.ai/go/gpt | Existing | README and homepage route users to the GPT |
| GPT Action schema | https://thumbgate.ai/openapi.yaml | Existing | Public OpenAPI route for GPT Actions import |
| Codex plugin page | https://thumbgate.ai/codex-plugin | Existing | Public install page |
| Codex release bundle | https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-codex-plugin.zip | Existing | GitHub release asset |
| Codex install docs | plugins/codex-profile/INSTALL.md | Existing | Repo install guide |
| LLM discovery context | https://thumbgate.ai/llm-context.md | Updated | Mentions ChatGPT App and Codex Plugin |

## Positioning Guardrails

- Say "ChatGPT App / GPT Action" or "ThumbGate GPT"; do not say that native ChatGPT rating buttons automatically write ThumbGate memory.
- Say "Codex plugin" for the owned release bundle and install page; do not claim official OpenAI marketplace approval unless there is a verifiable approval URL.
- Say "local enforcement" for blocking: `npx thumbgate init`, MCP server, hooks, and CI gates.
- Say "typed thumbs-up/down lessons" for ChatGPT capture: users must type one concrete feedback sentence.

## Submission Queue

These are ready-to-submit targets. They are not marked submitted by this document.

| Channel | Asset to Submit | Owner Copy |
| --- | --- | --- |
| ChatGPT GPT directory/share | https://thumbgate.ai/chatgpt-app and https://thumbgate.ai/go/gpt | "Preflight risky agent actions in ChatGPT, then enforce learned lessons locally in Codex, Claude Code, Cursor, and MCP agents." |
| Codex / developer plugin directories | https://thumbgate.ai/codex-plugin | "Standalone Codex plugin bundle that installs ThumbGate MCP + hooks and resolves thumbgate@latest at runtime." |
| GitHub topics/readme | README Integrations section | "ChatGPT GPT Action + Codex plugin distribution for agent guardrails." |
| AI tool directories | https://thumbgate.ai/chatgpt-app and https://thumbgate.ai/codex-plugin | "Thumbs-up/down lessons become pre-action checks for AI coding agents." |
| Product Hunt / launch post | Both pages | "Stop AI agents from repeating the same mistake: ChatGPT for review, Codex for enforcement." |
| MCP directories | GitHub repo and `.well-known/mcp/server-card.json` | "MCP-compatible prevention layer with feedback-derived gates." |

## Copy Blocks

### ChatGPT Short

ThumbGate for ChatGPT lets teams preflight risky AI-agent actions, capture typed thumbs-up/down lessons, and route those lessons into local enforcement for Codex, Claude Code, Cursor, Gemini CLI, and MCP agents.

### Codex Short

ThumbGate's Codex plugin installs a local MCP server and hook bundle so repeated failures become pre-action blocks before Codex executes tools.

### Enterprise Short

Use ChatGPT as the human review surface, Codex as the execution surface, and ThumbGate as the shared rule and evidence layer that remembers rejected patterns across sessions.

## Verification Added

- `tests/public-static-assets.test.js` checks `/chatgpt-app`, `/chatgpt-app.html`, `/chatgpt-plugin`, HEAD responses, and sitemap priority.
- `tests/public-package-parity.test.js` covers package inclusion for the new public HTML file via the package `files` list.
- README and LLM discovery files now link the ChatGPT and Codex surfaces from the same integration cluster.
