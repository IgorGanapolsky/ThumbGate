---
"thumbgate": patch
---

Add `GET /v1/telemetry/export` — operator-key-gated endpoint that returns recent raw telemetry-pings + funnel-events rows so the Daily Revenue Loop CI can pull first-party event data off the Railway container and join CTA-click attribution into the unified revenue rollup. Closes the third gap surfaced in the 2026-05-15 audit (Plausible reports pageview→pageview, Stripe reports charges, but the pageview→CTA-click handoff lives in `.thumbgate/telemetry-pings.jsonl` on Railway with no export path).

Endpoint contract:
- Auth: `THUMBGATE_OPERATOR_KEY` or the admin `THUMBGATE_API_KEY` (same auth shape as `/v1/billing/summary`).
- Query params: `since` (ISO8601, default last 24h), `limit` (default 1000, hard cap 10000), `source` (`telemetry` | `funnel` | `both`, default `both`).
- Returns `{ generatedAt, since, limit, source, telemetry: { rows, truncated, totalAfterSince }, funnel: { rows, truncated, totalAfterSince } }`.
- Truncation keeps the MOST RECENT rows (slice(-limit)) and signals via `truncated: true`.
- Graceful: missing JSONL files return `rows: []`, never a crash.

12 integration tests cover both auth paths, both rejection paths, every query parameter, the since-window filter, the truncation behavior, the hard-cap clamp, the negative-limit fallback, and the stable response schema.
