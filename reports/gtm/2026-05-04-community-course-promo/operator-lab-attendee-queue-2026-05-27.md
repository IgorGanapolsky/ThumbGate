# Operator Lab Attendee Queue + Outreach Drafts (Prep Only)

Prepared: 2026-05-27

Guardrail: do not publish posts, send messages, invite members, upload files, create accounts, change billing, submit forms, or run paid ads without explicit action-time confirmation.

Skool group: https://www.skool.com/thumbgate-operator-lab-6000

## Target personas (high intent)

1. AI coding agent operators shipping in real repos (Claude Code / Codex / Cursor / Gemini CLI / Amp / OpenCode / MCP).
2. Builders who already described a repeated failure pattern: context drift, rollback risk, unsafe tool calls, brittle prompt guardrails.
3. Teams with approval boundaries (PR review gates, deploy gates, incident response, compliance-ish workflows).

## Offer routing (quick)

- If they explicitly want the tool path: route to guide → Pro.
  - Guide: https://thumbgate-production.up.railway.app/guide
  - Pro: https://thumbgate-production.up.railway.app/checkout/pro
- If they name a repeated workflow blocker + one owner: route to Diagnostic/Sprint via intake.
  - Intake: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

## Today’s acquisition queue (approval-ready targets)

Use these as “where to look” targets; pick 10 threads/posts where the author already surfaced a repeated failure.

- Reddit: `r/ClaudeAI`, `r/CursorAI`, `r/LocalLLaMA`, `r/LanguageTechnology`, `r/MachineLearning`, `r/programming`, `r/devops`, `r/SaaS`
- GitHub: repositories mentioning “agent”, “mcp”, “Claude Code”, “Cursor”, “pre-commit hook”, “guardrails”, “policy”, “tool calling”
- Hacker News: threads about AI coding agents, evals, and reliability (look for “it broke when…” language)
- YouTube: creators posting “agent workflow” builds (comments often contain the real pain)
- Skool: adjacent groups discussing AI automations / workflow systems (respond in comments first; do not spam DMs)

## Outreach templates (copy/paste)

### A) Comment reply (short; “bring one failure”)

“This is exactly the kind of repeated agent failure I’m collecting right now. I run a free Skool group (ThumbGate Operator Lab): post one repeated Claude Code / Codex / Cursor / Gemini / MCP failure and we’ll turn it into one prevention rule (pre-action gate / Infrastructure Firewall) + a proof run. If you want in: https://www.skool.com/thumbgate-operator-lab-6000”

### B) DM opener (warm; pain-first)

“Saw your note about {pain}. If you’re open, I run a free Operator Lab where we take one repeated AI-agent workflow mistake and turn it into an enforceable pre-action gate (Infrastructure Firewall) + proof. Join here: https://www.skool.com/thumbgate-operator-lab-6000”

### C) DM follow-up (when they ask “what is it?”)

“Super practical format:
1) you paste one repeated failure
2) we define the smallest check that blocks it before the tool call
3) we run a proof pass to confirm the repeat stops

If you want hands-on hardening for one workflow, the Diagnostic/Sprint intake is here: https://thumbgate-production.up.railway.app/#workflow-sprint-intake”

### D) DM routing (self-serve)

“If you want the self-serve path first, start with the setup guide: https://thumbgate-production.up.railway.app/guide
If one repeat still keeps happening, Pro is the clean next step: https://thumbgate-production.up.railway.app/checkout/pro”

## Action-time confirmation checklist (when approved)

1. Pick the first channel batch (e.g. the 4 warm Reddit follow-ups in `reports/gtm/2026-05-04-money-now/warm-follow-up-pack-2026-05-27.md`).
2. Send exactly the drafted message text (no improvising pricing/traction claims).
3. After each send, log the stage advance using the row’s command in `reports/gtm/2026-05-04-money-now/operator-send-now.md` (uses `npm run sales:pipeline -- advance ...`).
4. If anyone replies with pain, route using `reports/gtm/2026-05-04-money-now/revenue-close-room.md` (Diagnostic → Sprint → Pro).

