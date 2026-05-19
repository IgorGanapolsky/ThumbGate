---
"thumbgate": minor
---

Add `/long-running-agents` ICP landing page surfacing ThumbGate as the deterministic enforcement layer the new agent-runtime category needs.

Context: The New Stack's 2026-05-18 coverage of Google's leaked Remy agent (`https://thenewstack.io/google-remy-agent-infrastructure/`) frames the shift to long-running autonomous AI agents as a runtime story, not a product story. Three independent enterprise voices in one article — Seth Rogers (Kyndryl), Devin Cheevers (Grafana Labs), Yaron Schneider (Diagrid) — converge on the same architectural conclusion: model-level safety controls are statistical and cannot meet the deterministic assurance bar regulated industries require. That gap is exactly the surface area ThumbGate's PreToolUse hooks already fill.

The new page surfaces the framing with attributed quotes (each ≤15 words, properly cited to TNS + the speaker's org), then maps each new runtime concern (durable execution graphs, long-lived state, async orchestration, delegated permissions, removed human-in-the-loop checkpoints) onto ThumbGate's existing enforcement surface. Targets boards / risk committees / Agent Managers — the buyers the article names directly.

Changes:
- `public/long-running-agents.html` — new ICP landing page modeled on `/agent-manager` and `/evals`.
- `src/api/server.js` — dedicated `/long-running-agents` + `/long-running-agents.html` route via `servePublicMarketingPage` with `extraTelemetry: { pageType: 'long_running_agents' }`.
- `src/api/server.js` `renderSitemapXml` — `/long-running-agents` at priority 0.9.
- `package.json` `files[]` — page added so it ships in the npm bundle. New script `test:long-running-agents` wired into the chain.
- `tests/long-running-agents.test.js` — 5 route-handler tests (200, alias parity, HEAD, pageType telemetry tag, UTM attribution).
- `tests/public-bundle-ratchet.test.js` + `tests/package-boundary.test.js` — ceiling 254 → 255.

Not a competitor reply to Google or Remy. The page extends the architecture argument these analysts already made to its operational consequence: a deterministic runtime gate.
