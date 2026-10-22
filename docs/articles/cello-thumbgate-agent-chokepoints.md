# How Cello & ThumbGate Stop Autonomous Agents From Burning Credits, Fabricating Resumes, and Sending Unapproved Emails

> **Featured Open-Source Architecture:** [`Devil-Hawk/cello`](https://github.com/Devil-Hawk/cello) by **Ankit Punjabi** × [`IgorGanapolsky/ThumbGate`](https://github.com/IgorGanapolsky/ThumbGate)

Most multi-agent applications rely on prompt instructions (`"Never invent facts"` or `"Ask before sending"`) and hope the model obeys when context hits 100k tokens.

In [`Devil-Hawk/cello`](https://github.com/Devil-Hawk/cello) — a 17-agent LangGraph + MCP career & outreach engine backed by 3,100+ automated tests — engineer **Ankit Punjabi** took a radically stricter approach: **invariants live in mutation-tested source scans and atomic state transitions, not prompts.**

Here is how Cello's 5 architectural chokepoints work under the hood, and how pairing Cello with **ThumbGate** turns every rejected draft or judge verdict into a `<0.5ms` `PreToolUse` rule and DPO training pair.

---

## 1. Closing the Two-Step "Approve-Then-Send" Arming Bug

In [`apps/web/lib/outreach/guardrails.ts`](https://github.com/Devil-Hawk/cello/blob/main/apps/web/lib/outreach/guardrails.ts), Cello documents and eliminates a subtle distributed-state bug that plagues almost every human-in-the-loop agent queue:

- **The Bug:** If a UI first `PATCH`es a draft row to `status = 'approved'` and *then* calls `POST /send`, a transient failure on the send leg (rate limit, daily cap, OAuth expiry) leaves the message armed as `'approved'` in Postgres. Any subsequent cron job sees `status === 'approved'` and fires the email without the user's knowledge.
- **The Fix (`SendIntent.humanApproved`):** Cello keeps the database row in `'pending_review'` and passes `{ humanApproved: true }` atomically inside the send request itself. If delivery fails for any reason, the row remains `'pending_review'`.
- **Fail-Closed `NaN` Timestamp Guard:** In `followUpWindowElapsed()`, Cello explicitly checks `if (!Number.isFinite(sentMs)) return { allowed: false }` because `NaN < needMs` evaluates to `false` in JavaScript and would otherwise fall through to `{ allowed: true }`.

## 2. Stateless MCP Refusal When No Human Confirmation Channel Exists

Cello exposes its 18 copilot tools via a stateless Streamable HTTP MCP server ([`apps/web/app/api/mcp/route.ts`](https://github.com/Devil-Hawk/cello/blob/main/apps/web/app/api/mcp/route.ts)):
- In the web UI, `dispatchExecute` pauses at a LangGraph `interrupt()` when `submitOrSendReason()` flags a tool.
- Over headless MCP, there is no human confirmation UI. Rather than downgrading to auto-approval or hanging a serverless function on an unanswerable interrupt, Cello's `mcpView()` strips and refuses every send/submit tool at the door.

## 3. Pairing Cello With ThumbGate (`PreToolUse` + DPO Distillation)

By connecting Cello's `user-mcp.ts` client and judge pipeline (`want-judge.ts`, `claims-judge.ts`, `outreach/guardrails.ts`) to **ThumbGate**:
1. **Sub-Millisecond Pre-Action Interdiction (`<0.5ms` p95):** Every coding agent and MCP tool call is checked before execution against local SQLite prevention rules.
2. **Judge Verdicts → DPO Preference Pairs:** Whenever Cello's `claims-judge` catches a fabricated resume line against ground truth or a user gives a `👎` on an outreach draft, ThumbGate pairs the rejected draft with the approved revision and exports ready-to-train DPO / HuggingFace JSONL datasets (`npx thumbgate export-dpo`).
