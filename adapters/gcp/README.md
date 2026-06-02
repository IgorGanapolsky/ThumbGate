# ThumbGate Enterprise — GCP / Dialogflow CX guardrails

Enterprise add-on. **Not shipped in the public npm package** — it lives in-repo so a pilot can deploy it as Cloud Run / Cloud Functions middleware inside the customer's GCP tenant.

Important setup note: do **not** use `gcloud alpha dialogflow cx` as proof of a live DFCX agent. That command group is not available in current gcloud installs. Verify agents through the Google Cloud Conversational Agents / Dialogflow CX console or the official Dialogflow CX REST API (`projects.locations.agents`).

## What it is

A **pre-action gate in front of your existing Dialogflow CX fulfillment.** It runs ThumbGate's gate engine against each fulfillment turn *before* the side-effect (BigQuery / CRM / billing write) executes. If a configured policy gate denies the action — or the action is a same-session repeat — the side-effect is blocked and a safe response is returned instead.

```
Dialogflow CX  ──►  ThumbGate gate  ──►  [allowed]  your existing fulfillment URL
                                     ──►  [blocked]  safe response, no side-effect
```

It does **not** call any Google API, mutate Playbooks, or replace your fulfillment. It decides whether your fulfillment is allowed to run, and records each action for repeat detection.

## Components

| File | Purpose |
|---|---|
| `dfcx-webhook-gate.js` | Core: maps a DFCX `WebhookRequest` → ThumbGate action, runs `evaluateGates` + repeat detection, returns allow/block. Pure + testable. |
| `server.js` | Cloud Run / Functions entrypoint — a drop-in **proxy** that forwards allowed turns to `THUMBGATE_DFCX_FULFILLMENT_URL`. |
| `vertex-scorer.js` | Optional: runs ThumbGate scoring prompts on **Gemini / Vertex AI inside the customer tenant** (REST, no SDK). |
| `Dockerfile` | Slim Cloud Run container. |

## Configure (env)

| Var | Meaning |
|---|---|
| `THUMBGATE_DFCX_FULFILLMENT_URL` | Your existing fulfillment webhook. Allowed turns are forwarded here. |
| `THUMBGATE_DFCX_BLOCK_MESSAGE` | Optional caller-facing message shown on block. |
| `PORT` | Set by Cloud Run (default 8080). |
| `GEMINI_API_KEY` *or* `GOOGLE_VERTEX_PROJECT` + `GOOGLE_VERTEX_LOCATION` + `GOOGLE_VERTEX_TOKEN` | Optional — enable Gemini/Vertex scoring in-tenant. |

## Deploy

```bash
gcloud builds submit --tag REGION-docker.pkg.dev/PROJECT/REPO/thumbgate-dfcx-gate -f adapters/gcp/Dockerfile .
gcloud run deploy thumbgate-dfcx-gate \
  --image REGION-docker.pkg.dev/PROJECT/REPO/thumbgate-dfcx-gate \
  --region REGION --no-allow-unauthenticated \
  --set-env-vars THUMBGATE_DFCX_FULFILLMENT_URL=https://your-existing-fulfillment
```

Then point your DFCX webhook at the Cloud Run URL.

To inventory or prove live agents, use the Dialogflow CX REST API rather than a nonexistent `gcloud alpha dialogflow cx` command. Example:

```bash
ACCESS_TOKEN="$(gcloud auth print-access-token)"
curl -sS -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  "https://dialogflow.googleapis.com/v3/projects/PROJECT_ID/locations/LOCATION_ID/agents"
```

## What it does NOT do (yet)

To be explicit, so nothing is oversold:
- No native Dialogflow CX **marketplace** integration.
- No **automatic Playbook mutation** — thumbs-down / QA findings become *reviewed* prevention rules, never automatic production changes.
- No claimed **compliance certification** (SOC 2, etc.) — deployment runs in *your* tenant; certification is a separate, real process.
- The pre-built **CCAI/compliance dashboard** is delivered as part of a pilot, not a product button.

## Decision logging

Every turn emits a structured JSON line to stdout (ingested by Cloud Logging):

```json
{"component":"thumbgate-dfcx-gate","tag":"process-refund","allowed":false,"gate":"...","repeat":false,"severity":"critical"}
```
