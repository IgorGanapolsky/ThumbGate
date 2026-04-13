# ChatGPT GPT Actions: ThumbGate Install

Use the published ThumbGate GPT from GPT Store when it is visible for your account, or import the OpenAPI spec into a Custom GPT in under 5 minutes. Regular users use it by replying with 👍/👎 or "thumbs up/down" on ChatGPT answers so ThumbGate remembers lessons, prevents repeated bad answers, and reinforces the answers that worked.

## GPT Store path

1. Open ChatGPT.
2. Open **Explore GPTs**.
3. Search for `ThumbGate`.
4. Choose the GPT by **Igor Ganapolsky** in the **Programming** category.

Direct store URL status: published by the operator on April 13, 2026, but the public `chatgpt.com/g/...` URL has not been captured in this repo yet. Do not invent a URL; add it here once the share link is available.

## 30-second regular-user flow

1. Ask the ThumbGate GPT any normal question.
2. If the answer helped, reply with `👍` plus one sentence about what worked.
3. If the answer missed, reply with `👎` plus one sentence about what to change.
4. Ask `What do you remember about how I like answers?` to verify the saved lessons.

The user should never need to know what MCP, OpenAPI, Actions, DPO, or prevention rules mean. The GPT should explain the loop as: "Reply 👍 or 👎. I remember the lesson for next time."

## Regular-user prompts

Use these as GPT conversation starters so regular users know how to teach ThumbGate:

1. `👎 this answer was too vague. Next time give me exact steps.`
2. `👍 this format worked. Remember to answer with short numbered steps.`
3. `Thumbs down: you assumed I know technical terms. Next time explain it for a beginner first.`
4. `Remember this lesson: I prefer direct answers with examples before theory.`
5. `Search my ThumbGate lessons before answering this.`

Use typed chat replies. ChatGPT's native feedback buttons may send feedback to OpenAI, but they should not be described as the ThumbGate capture path unless OpenAI exposes them to GPT Actions.

## Best first GPT message

Use this as the first response for regular users:

```text
Ask me anything. After my answer, reply 👍 if it helped or 👎 plus one sentence if it missed. I will remember the lesson, avoid repeating bad answer patterns, and reuse the formats you like.
```

## Prerequisites

- A ChatGPT Plus or Team account (Custom GPTs require a paid plan)
- ThumbGate API running at `https://thumbgate-production.up.railway.app`
- Privacy policy URL: `https://thumbgate-production.up.railway.app/privacy`
- Bearer API key for the Actions auth prompt

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
