# ChatGPT GPT Actions: MCP Memory Gateway Install

Import the OpenAPI spec into a Custom GPT in under 5 minutes. No coding required.

## Prerequisites

- A ChatGPT Plus or Team account (Custom GPTs require a paid plan)
- RLHF API running at a public HTTPS URL (see [Deployment docs](../../docs/deployment.md))

## Step 1 — Open GPT Builder

1. Go to [https://chat.openai.com/gpts/editor](https://chat.openai.com/gpts/editor)
2. Click **Create a GPT**
3. Switch to the **Configure** tab

## Step 2 — Add Actions

1. Scroll to the **Actions** section
2. Click **Create new action**
3. Click **Import from URL** — paste your hosted spec URL:
   ```
   https://<your-railway-domain>/openapi.yaml
   ```
   Or click **Upload file** and select:
   ```
   adapters/chatgpt/openapi.yaml
   ```

## Step 3 — Set Authentication

In the Actions panel:

1. Select **Authentication type: API Key**
2. **Auth type**: Bearer
3. **API Key**: paste your `RLHF_API_KEY` value

## Step 4 — Update the Server URL

In the imported spec, confirm the `servers.url` points to your deployed API:

```yaml
servers:
  - url: https://<your-railway-domain>
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

- **401 Unauthorized**: Verify `RLHF_API_KEY` is set and matches the Bearer token
- **Connection refused**: Confirm Railway deployment is live (`curl https://<domain>/health`)
- **Schema errors**: Ensure you are using the latest `openapi.yaml` (version 1.1.0+)
