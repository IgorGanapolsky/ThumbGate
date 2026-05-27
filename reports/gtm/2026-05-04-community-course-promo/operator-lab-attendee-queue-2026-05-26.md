# Operator Lab Attendee Queue + Outreach Drafts (Prep Only)

Prepared: 2026-05-26

Guardrail: do not publish posts, send messages, invite members, upload files, create accounts, change billing, submit forms, or run paid ads without explicit action-time confirmation.

Skool group: https://www.skool.com/thumbgate-operator-lab-6000

## Target personas (high intent)

1. AI coding agent operators shipping in real repos (Claude Code / Codex / Cursor / Gemini / Amp / OpenCode / MCP).
2. Builders who already described a repeated failure pattern: context drift, rollback risk, unsafe tool calls, brittle prompt guardrails.
3. Teams with approval boundaries (PR review gates, deploy gates, incident response, compliance-ish workflows).

## Offer routing (quick)

- If they explicitly want the tool path: route to guide → Pro.
  - Guide: https://thumbgate-production.up.railway.app/guide
  - Pro: https://thumbgate-production.up.railway.app/checkout/pro
- If they name a repeated workflow blocker + one owner: route to Diagnostic/Sprint via intake.
  - Intake: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

## Outreach templates (copy/paste)

### A) Comment reply (short; “bring one failure”)

“This is exactly the kind of repeated agent failure I’m collecting right now. I started a free Skool group (ThumbGate Operator Lab): post one repeated Claude Code / Codex / Cursor / Gemini / MCP failure and we’ll turn it into one prevention rule (pre-action gate) + a proof run. If you want in: https://www.skool.com/thumbgate-operator-lab-6000”

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

1. Pick the first channel batch (e.g. 4 warm Reddit DMs already staged in `reports/gtm/2026-05-04-money-now/operator-send-now.md`).
2. Send exactly the drafted message text (no improvising pricing/traction claims).
3. After each send, run that row’s `Log after send` command.
4. If anyone replies with pain, reply with the close-room script (Diagnostic/Sprint/Pro) from `reports/gtm/2026-05-04-money-now/revenue-close-room.md`.

