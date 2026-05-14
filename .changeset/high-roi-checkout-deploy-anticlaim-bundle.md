---
"thumbgate": minor
---

Ship the high-ROI bundle from the 2026-05-13 revenue-ROI critique. Four code-side improvements ranked by revenue ROI, plus one positioning doc:

- **#4 Deploy-verification GitHub Action** (`.github/workflows/deploy-verify.yml`) — triggers on push to main, waits 180s for Railway rebuild, curls `/health` for expected version, curls `/dashboard` for sentinel string, samples any `public/learn|guides|compare/*.html` routes added in the diff, posts a green/red comment on the merging PR. Ends the recurring "did it actually deploy?" trust-burn pattern. The Deployment Verification Gate from CLAUDE.md was manual; now it's automated.

- **#2 Plausible custom funnel events** (`scripts/plausible-server-events.js` + 3 server-side fires in `src/api/server.js`) — emits `Checkout Pro Viewed` / `Checkout Pro Email Submitted` / `Checkout Pro Stripe Redirect Started` to the Plausible events API alongside the existing JSONL telemetry. Fire-and-forget, 2s timeout, opt-out via `THUMBGATE_PLAUSIBLE_DISABLE=1` or `DO_NOT_TRACK=1`. Closes the "0/50 checkouts and we don't know why" visibility gap — the three transitions now show up in the same dashboard where pageviews already live, exposing exactly where the funnel drops (landing → email → Stripe → paid).

- **#1 Activation telemetry** (`scripts/activation-tracker.js` + hook in `scripts/feedback-loop.js`) — anonymous `activation_first_rule_promoted` ping the first time a prevention rule auto-promotes for an install. Payload: `installId` + `daysToFirstRule` + `visitorType` (ci|owner|real_user) + `promotionCount` + `totalGates`. Idempotent via marker file under `~/.thumbgate/activation/`. Critical metric for the v1.17.0 free-tier-opening experiment: % of `npx thumbgate init` runs that produce a first auto-promoted rule within 24h. Respects existing telemetry opt-outs.

- **#5 Anti-claim Stop hook** (`scripts/hook-stop-anti-claim.js` registered in `.claude/settings.json`) — scans the assistant's most recent turn for completion-claim wording ("is live", "deployed", "fixed", "ready", "shipped"). If the same turn lacks a proof tool call (`curl`, `gh pr view`, `gh api`, `npm test`, `node --test`, `Bash(...)`, `Read(...)`), prints a system reminder for the next turn. ThumbGate-on-ThumbGate dogfood — the harness now enforces the anti-lying directive that CLAUDE.md asks for but didn't enforce. Informational (never hard-blocks), so the agent corrects mid-conversation rather than losing the turn.

- **Databricks positioning brief** (`docs/DATABRICKS.md`) — composition map showing how ThumbGate composes with MLflow / Unity Catalog / Mosaic AI / Vector Search without claiming integration. Cheap pre-LOI artifact so "they call out Databricks exposure" RFP / recruiter conversations have a credible answer. Same pulled-by-demand sequencing as `docs/FEDERAL.md`.

New tests: `tests/plausible-server-events.test.js` (10), `tests/activation-tracker.test.js` (5), `tests/hook-stop-anti-claim.test.js` (10). All pass locally.
