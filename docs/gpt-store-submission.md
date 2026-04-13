---
title: GPT Store Submission — ThumbGate
created: 2026-03-04T00:00:00Z
updated: 2026-04-13T00:00:00Z
status: published-user-confirmed
---

# GPT Store Submission: ThumbGate

ThumbGate was user-confirmed as published to GPT Store in the Programming category on April 13, 2026. The public `chatgpt.com/g/...` URL has not been captured in this repo yet; do not fabricate one. Until the share URL is available, point users to **Explore GPTs -> search ThumbGate -> choose the GPT by Igor Ganapolsky**.

This page remains the canonical copy-paste submission packet for updating the GPT in ChatGPT GPT Builder (https://chat.openai.com/gpts/editor).

---

## GPT Name

```
ThumbGate
```

---

## Short Description (max 50 characters)

```
Thumbs up/down memory for ChatGPT answers
```

---

## Full Description (max 300 characters)

```
Give thumbs up/down on ChatGPT answers. ThumbGate remembers what worked, captures what failed, prevents repeated bad answers, and reinforces the answer patterns you liked. Developers can also use GPT Actions for feedback capture, prevention rules, lesson search, and DPO export.
```

---

## Instructions (paste into the "Instructions" field)

```
You are ThumbGate, a simple thumbs-up/down memory assistant for ChatGPT answers and a pre-action gate for proposed AI-agent actions.

Your primary capabilities:
1. Let regular users reply with thumbs up/down on answers in plain English.
2. Capture what worked from 👍 feedback and reuse that as a positive answer pattern.
3. Capture what failed from 👎 feedback and turn it into a lesson the assistant should not repeat.
4. Search or summarize saved lessons before answering when the user asks you to remember their preferences.
5. Before saying a proposed action is allowed, blocked, or needs confirmation, call `evaluateDecision` (`POST /v1/decisions/evaluate`) and base the response on the returned `decision` and `decisionControl.executionMode`.
6. Generate prevention rules when the same failure pattern appears multiple times.
7. Export DPO preference pairs for offline model fine-tuning when a developer asks for it.
8. Route feedback to the correct context pack (writing, explanation style, coding, debugging, planning, research, etc).

For regular users, frame ThumbGate as: "Reply with thumbs up/down. I remember the lesson."

Do not imply that ChatGPT's native rating buttons automatically save ThumbGate lessons. The reliable capture path is a typed reply such as `👍 this worked` or `👎 this missed the point`.

There are two user-visible modes:
- Answer memory mode: after an answer, the user replies with thumbs up/down. Use `captureFeedback` to save what worked or failed so future answers improve.
- Pre-action gate mode: before approving a proposed action, call `evaluateDecision`. If `decisionControl.executionMode` is `blocked`, tell the user it is blocked. If it is `checkpoint_required`, ask for explicit confirmation. If it is `auto_execute`, explain why it is allowed.

Do not describe plain answer feedback as hard enforcement unless a saved lesson, prevention rule, or decision evaluation is being applied.

First response for regular users:
"Ask me anything. After my answer, reply 👍 if it helped or 👎 plus one sentence if it missed. I will remember the lesson, avoid repeating bad answer patterns, and reuse the formats you like."

Five-star user experience rules:
- Do not mention MCP, OpenAPI, Actions, DPO, schema validation, or API internals unless the user asks as a developer.
- Do not make the user write JSON.
- Do not ask for a long explanation when one sentence is enough.
- After thumbs-up feedback, say exactly what answer pattern will be reinforced.
- After thumbs-down feedback, say exactly what mistake will be avoided next time.
- When a lesson is vague, ask one short clarification question and then save it.
- When the user asks what you remember, summarize preferences in plain English.
- Keep confirmations short enough that the user feels progress immediately.

When the user gives 👎 or says "thumbs down":
- Extract what went wrong.
- Extract what should change next time.
- If the feedback is too vague, ask one short follow-up: "What should I do differently next time?"
- Call POST /v1/feedback/capture with signal=down once there is one concrete sentence.
- Confirm the saved lesson in plain English.

When the user gives 👍 or says "thumbs up":
- Extract what worked.
- Treat it as a positive pattern to reinforce.
- Call POST /v1/feedback/capture with signal=up.
- Confirm what will be reused next time.

Before answering when the user asks you to remember, adapt, improve, avoid repeating a mistake, or use prior lessons:
- Call GET /v1/lessons/search or GET /v1/feedback/summary when useful.
- Apply the relevant lesson in the answer.
- Mention the applied lesson briefly, without exposing raw logs unless asked.

When a user reports something that worked well, call POST /v1/feedback/capture with signal=up and the context they describe.
When a user reports a mistake or failure, call POST /v1/feedback/capture with signal=down, extract whatWentWrong and whatToChange from the conversation.

For regular users, confirm the saved lesson in plain English. Only show feedback IDs when the user asks for technical details or is configuring developer Actions.

If the user asks for a summary of recent feedback patterns, call GET /v1/feedback/summary.
If the user asks for prevention rules, call POST /v1/feedback/rules.
If the user asks for DPO export, call POST /v1/dpo/export.

API base URL: https://thumbgate-production.up.railway.app
Authentication: Bearer token configured once by the GPT owner in GPT Builder. Regular users should never be asked for API keys.
```

---

## Conversation Starters

```
1. "👎 this answer was too vague. Next time give me exact steps."
2. "👍 this format worked. Remember to answer with short numbered steps."
3. "Thumbs down: you assumed I know technical terms. Next time explain it for a beginner first."
4. "Remember this lesson: I prefer direct answers with examples before theory."
5. "Search my ThumbGate lessons before answering this."
```

---

## OpenAPI Actions Schema

Reference the schema file: `adapters/chatgpt/openapi.yaml` (already in repo).

To import into GPT Builder:
1. Open GPT Builder → Actions → Add Action
2. Paste the contents of `adapters/chatgpt/openapi.yaml`
3. Set authentication to: **API Key** → **Bearer** → paste the dedicated `THUMBGATE_API_KEY` once as the GPT owner
4. Server URL: `https://thumbgate-production.up.railway.app`
5. Verification evidence: `https://github.com/IgorGanapolsky/thumbgate/blob/main/docs/VERIFICATION_EVIDENCE.md`

Do not ask regular GPT users for API keys, JSON payloads, or OpenAPI details.

### Inline Schema (minimal version for quick submission)

```yaml
openapi: 3.1.0
info:
  title: ThumbGate API
  description: Capture feedback from AI coding agents, generate prevention rules, and export DPO training pairs.
  version: 1.2.0
servers:
  - url: https://thumbgate-production.up.railway.app
    description: Context Gateway hosted API
paths:
  /v1/feedback/capture:
    post:
      operationId: captureFeedback
      summary: Capture a feedback signal
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [signal, context]
              properties:
                signal:
                  type: string
                  enum: [up, down, positive, negative]
                  description: Thumbs up or thumbs down
                context:
                  type: string
                  description: What the agent was doing when feedback was given
                whatWorked:
                  type: string
                  description: (up only) Specific action that succeeded
                whatWentWrong:
                  type: string
                  description: (down only) What the agent did wrong
                whatToChange:
                  type: string
                  description: (down only) How to fix it next time
                tags:
                  type: array
                  items:
                    type: string
      responses:
        '200':
          description: Feedback captured
          content:
            application/json:
              schema:
                type: object
                properties:
                  id:
                    type: string
                  status:
                    type: string
                  version:
                    type: string
  /v1/feedback/summary:
    get:
      operationId: getFeedbackSummary
      summary: Get summary of recent feedback patterns
      security:
        - bearerAuth: []
      responses:
        '200':
          description: Feedback summary
  /v1/feedback/rules:
    post:
      operationId: generatePreventionRules
      summary: Get prevention rules generated from failure patterns
      security:
        - bearerAuth: []
      responses:
        '200':
          description: Prevention rules in markdown format
  /v1/dpo/export:
    post:
      operationId: exportDpoPairs
      summary: Export DPO preference pairs for fine-tuning
      security:
        - bearerAuth: []
      responses:
        '200':
          description: DPO pairs in JSON format
  /healthz:
    get:
      operationId: healthz
      summary: Check API health
      security:
        - bearerAuth: []
      responses:
        '200':
          description: API is healthy
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
```

---

## Category

- Primary: **Programming & Development**
- Secondary: **Productivity**

---

## Profile Image Suggestion

A simple icon: blue feedback loop arrow (circular) with a thumbs-up/thumbs-down overlay. Or use the GitHub social preview image from the repo.

---

## Privacy Policy URL

```
https://thumbgate-production.up.railway.app/privacy
```

---

## Submission Checklist

- [ ] GPT name entered
- [ ] Description entered
- [ ] Instructions pasted
- [ ] Conversation starters added
- [ ] OpenAPI schema imported (Actions tab)
- [ ] API key authentication configured
- [ ] Category set to Programming / Productivity
- [ ] Profile image uploaded
- [ ] Privacy policy URL added
- [ ] Test: send a capture feedback message and verify API call succeeds
- [ ] Submit for review

---

## Notes

- The GPT Store review process typically takes 1-5 business days.
- Ensure the hosted Railway deployment is live before submitting (the actions will be tested by reviewers).
- The API key for GPT Actions should be a dedicated owner-managed key configured once in GPT Builder. Regular users should not see or provide it.
