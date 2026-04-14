# ChatGPT GPT Actions: ThumbGate Install

Open the published ThumbGate GPT directly:

https://chatgpt.com/g/g-69dcfd1cd5f881918ae31874631d6f08-thumbgate

Use the GPT as a setup concierge and memory capture surface: paste an AI action to check, save a thumbs-up/down lesson, write a Pre-Action Gate, install ThumbGate for an agent, or export proof. Real enforcement for coding agents still runs locally through ThumbGate hooks after `npx thumbgate init`.

## GPT Store path

1. Open the direct GPT URL: https://chatgpt.com/g/g-69dcfd1cd5f881918ae31874631d6f08-thumbgate
2. If ChatGPT does not open it for your account, open **Explore GPTs**.
3. Search for `ThumbGate`.
4. Choose the GPT by **Igor Ganapolsky** in the **Programming** category.

## 30-second user flow

1. Paste a proposed AI action, command, merge, deploy, file edit, email, payment, or API call.
2. ThumbGate evaluates whether to allow, block, or require a checkpoint before the action runs.
3. After any answer or agent run, reply with `thumbs up:` or `thumbs down:` plus one concrete sentence.
4. ThumbGate saves the lesson, refreshes prevention rules when patterns repeat, and can show what it remembers.

Regular users should never need to know MCP, OpenAPI, Actions, DPO, Thompson Sampling, or schema validation. The GPT should explain the loop as: "One signal becomes one remembered rule."

## GPT profile card

Use this copy in GPT Builder instead of the generic "AI safety gate" framing:

Short description:

```text
Turn thumbs-down into prevention gates
```

Full description:

```text
Paste a proposed AI action or reply thumbs up/down after an answer. ThumbGate captures the lesson, searches prior mistakes, writes Pre-Action Gates, and tells you when to allow, block, or checkpoint. Built for developers using AI agents and proof-backed Reliability Gateway workflows.
```

Conversation starters:

1. `Check this agent action before it runs: git push --force --tags`
2. `Turn this mistake into a ThumbGate rule: the agent edited generated files again.`
3. `Install ThumbGate for Claude Code or Codex in this repo.`
4. `Search my saved lessons before you answer.`

Use typed chat replies. ChatGPT's native feedback buttons may send feedback to OpenAI, but they should not be described as the ThumbGate capture path unless OpenAI exposes them to GPT Actions.

## Pre-action gate flow

Use this when the user asks whether an AI agent should run a proposed action, command, file edit, deployment, merge, or publish step:

1. The GPT calls `evaluateDecision` (`POST /v1/decisions/evaluate`) before answering.
2. If the response has `decisionControl.executionMode: "blocked"`, the GPT says the action is blocked and explains the returned reason.
3. If the response has `decisionControl.executionMode: "checkpoint_required"`, the GPT asks for explicit confirmation before proceeding.
4. If the response has `decisionControl.executionMode: "auto_execute"`, the GPT can say the action is allowed and summarize why.

Plain thumbs-up/down feedback is the memory loop. The decision endpoint is the gate loop. Do not claim hard blocking unless the decision endpoint, a saved lesson, or a prevention rule was actually applied.

## Best first GPT message

Use this as the first response:

```text
Paste an AI action to check, or tell me what went right/wrong. I can block risky actions, save the lesson, write a prevention gate, or show what ThumbGate already remembers.
```

## Prerequisites

- A ChatGPT Plus or Team account (Custom GPTs require a paid plan)
- ThumbGate API running at `https://thumbgate-production.up.railway.app`
- Privacy policy URL: `https://thumbgate-production.up.railway.app/privacy`
- Owner-managed `THUMBGATE_API_KEY` for one-time GPT Builder Actions auth

Regular GPT users should not need an API key, JSON payload, OpenAPI knowledge, or developer setup. They should only see the thumbs-up/down memory loop.

## Step 1 — Open GPT Builder

1. Go to [https://chat.openai.com/gpts/editor](https://chat.openai.com/gpts/editor)
2. Click **Create a GPT**
3. Switch to the **Configure** tab

## Step 2 — Add Actions

1. Scroll to the **Actions** section
2. Click **Create new action**
3. Click **Import from URL** — paste your hosted spec URL:
   ```
   https://thumbgate-production.up.railway.app/openapi.yaml
   ```
   Or click **Upload file** and select:
   ```
   adapters/chatgpt/openapi.yaml
   ```

## Step 3 — Set Authentication

In the Actions panel:

1. Select **Authentication type: API Key**
2. **Auth type**: Bearer
3. **API Key**: paste your `THUMBGATE_API_KEY` value

This is an owner setup field. Do not ask regular GPT users to provide an API key.

## Step 4 — Update the Server URL

In the imported spec, confirm the `servers.url` points to your deployed API:

```yaml
servers:
  - url: https://thumbgate-production.up.railway.app
```

If you uploaded the file, edit the server URL in the GPT Actions editor.

## Step 5 — Verify

Click **Test** on the `captureFeedback` action:

```json
{
  "signal": "up",
  "context": "GPT Actions install verified with a successful test call",
  "whatWorked": "The hosted action returned accepted=true and a promoted status"
}
```

Expected response: `200 OK` with `{ "accepted": true, "status": "promoted" }`.

If you only send a bare `thumbs up/down` style payload, expect `422` with `status: "clarification_required"` and a follow-up `prompt`.

## Available Actions

| Action | Method | Path | Description |
|---|---|---|---|
| `captureFeedback` | POST | `/v1/feedback/capture` | Capture up/down signal plus one-line why |
| `getFeedbackStats` | GET | `/v1/feedback/stats` | Aggregated feedback statistics |
| `getFeedbackSummary` | GET | `/v1/feedback/summary` | Recent feedback summary |
| `generatePreventionRules` | POST | `/v1/feedback/rules` | Generate prevention rules |
| `exportDpoPairs` | POST | `/v1/dpo/export` | Export DPO preference pairs |
| `listIntentCatalog` | GET | `/v1/intents/catalog` | List available intents |
| `planIntent` | POST | `/v1/intents/plan` | Generate policy-scoped plan |
| `constructContextPack` | POST | `/v1/context/construct` | Build context pack |

Full spec: `adapters/chatgpt/openapi.yaml`

## Troubleshooting

- **401 Unauthorized**: Verify `THUMBGATE_API_KEY` is set and matches the Bearer token
- **Connection refused**: Confirm Railway deployment is live (`curl https://<domain>/health`)
- **Schema errors**: Ensure you are using the latest `openapi.yaml` (version 1.1.0+)
