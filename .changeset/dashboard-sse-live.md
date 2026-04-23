---
"thumbgate": minor
---

feat(api): push dashboard updates over Server-Sent Events on `/v1/events`

Applies the "persistent channel beats per-turn HTTP round trip" pattern (the thesis of OpenAI's 2026-04 Responses-API WebSocket post) to the ThumbGate dashboard. Instead of re-fetching `/v1/feedback/stats` on a manual refresh, clients now subscribe once to `/v1/events` and receive pushed frames as feedback/rule-regen events happen.

Surface:

- **`GET /v1/events`** — Bearer-authed SSE stream. On connect the server emits an `event: connected` frame with the current server version; thereafter every `POST /v1/feedback/capture` emits an `event: feedback` frame (signal + tags + feedbackId + promoted) and every `POST /v1/feedback/rules` emits an `event: rules-updated` frame (path). Heartbeat comment frames every 25s keep Railway / proxy idle timers from closing the connection.
- **Dashboard client** (`public/dashboard.html`) — subscribes immediately after `connect()` using `fetch()` + `ReadableStream` (needed instead of native `EventSource` so we can send `Authorization: Bearer …`). On any event the client re-pulls `/v1/feedback/stats` and re-renders the summary cards.

Non-breaking: existing polled `/v1/feedback/stats`, `/v1/dashboard`, and `/v1/feedback/rules` endpoints are unchanged. Clients that don't open `/v1/events` behave exactly as before.

Why: manual refresh was the only way to see new feedback land in the dashboard, which made live demo sessions awkward and hid the real-time nature of the feedback loop. SSE is the right tool for server→client pushes here — no WebSocket upgrade dance, no extra deps, survives Railway's proxy with `X-Accel-Buffering: no`.
