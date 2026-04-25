# LAUNCH NOW — Discovery-First Revenue Checklist

**Status as of 2026-04-25:** local revenue status shows `0` lifetime revenue, `0` paid orders, `0` tracked leads, and `0` checkout starts. Treat this file as an operator playbook for creating qualified conversations, not as proof of traction.

Every line below is evidence-backed and channel-current. Do them in order.

---

## Pre-flight (5 min) — verify the funnel is alive

```bash
# 1. Landing page loads
curl -sS https://thumbgate-production.up.railway.app/ | grep -q 'ThumbGate' && echo "landing up" || echo "landing down"

# 2. Workflow sprint intake is reachable
curl -sS https://thumbgate-production.up.railway.app/ | grep -q 'workflow-sprint-intake' && echo "sprint intake linked" || echo "sprint intake missing"

# 3. Current commercial snapshot is explicit
npm run revenue:status:local
```

If any of those fail, stop and fix the funnel before outreach.

---

## Step 1 — generate the target queue

```bash
REPORT_DIR="reports/gtm/$(date +%F)-selling-now"
npm run gtm:revenue-loop -- --report-dir "$REPORT_DIR" --max-targets=12
```

Review four files before sending anything:

- `gtm-revenue-loop.md` for the current commercial truth and directive
- `gtm-revenue-loop.json` for the machine-readable queue
- `gtm-target-queue.csv` for operator copy/paste into a tracker or CRM
- `gtm-marketplace-copy.md` for listing-ready copy derived from the same target evidence

The generated queue now includes two lanes in one artifact:

- warm discovery targets from the current comment-engager list
- cold GitHub targets ranked by workflow evidence

Rule: if a target has weak workflow evidence, do not contact them just because they are recent.

---

## Step 2 — import the queue into the local sales ledger

```bash
npm run sales:pipeline -- import \
  --source "$REPORT_DIR/gtm-revenue-loop.json" \
  --out "$REPORT_DIR/sales-pipeline.md"
```

The lead only exists after it is in the ledger. A repo URL or social profile alone is not pipeline state.

---

## Step 3 — send the warm discovery messages first

Start with the warm targets surfaced at the top of the generated queue and mirrored in [docs/marketing/team-outreach-messages.md](docs/marketing/team-outreach-messages.md). The first-touch offer stays:

> I will harden one AI-agent workflow for you.

Do not lead with Pro.
Do not lead with the proof pack.
Do not count a sent message as progress until the lead is advanced to `contacted`.

---

## Step 4 — contact the strongest cold targets from the report

Use only the targets with clear workflow evidence, operator ownership, or production-system integration. Move each lead explicitly:

```bash
npm run sales:pipeline -- advance \
  --lead <lead-id> \
  --stage contacted \
  --channel github \
  --note "Sent workflow hardening outreach from the 2026-04-25 revenue loop"
```

Advance stages only when the real-world event happened:

`targeted -> contacted -> replied -> call_booked -> checkout_started or sprint_intake -> paid`

---

## Step 5 — use public channels only after direct outreach is running

Current active channels are Reddit, LinkedIn, Threads, Bluesky, Instagram, and YouTube.
X/Twitter is retired from active distribution.

Public posting is support for the direct pipeline, not the primary motion:

- Reddit: reply where the workflow pain is explicit, then route qualified leads into DM or intake.
- LinkedIn: post proof-backed workflow hardening content once buyer language is current.
- Threads, Bluesky, Instagram, YouTube: repurpose only after the direct offer and landing copy match what buyers actually said.

Do not treat generic posting as sales progress.

---

## Step 6 — update marketplace and proof assets only when they match reality

Before refreshing listing copy or directory submissions, make sure these remain aligned:

- the current `gtm-marketplace-copy.md` artifact from the revenue loop
- [docs/COMMERCIAL_TRUTH.md](docs/COMMERCIAL_TRUTH.md)
- [docs/VERIFICATION_EVIDENCE.md](docs/VERIFICATION_EVIDENCE.md)
- [.claude-plugin/marketplace.json](.claude-plugin/marketplace.json)
- [.agents/plugins/marketplace.json](.agents/plugins/marketplace.json)
- [plugins/cursor-marketplace/.cursor-plugin/plugin.json](plugins/cursor-marketplace/.cursor-plugin/plugin.json)

If the direct outreach language changes, update the listings to match. Never invent installs, customers, or revenue.

---

## Kill switches

- Landing page or intake is down: pause all outreach.
- Queue is full of weak or low-signal targets: improve targeting before sending messages.
- Public copy drifts from `COMMERCIAL_TRUTH.md`: fix the source copy before posting.
- Proof pack is used before pain is confirmed: stop and rewrite the outreach.

---

## What success looks like for the next 7 days

- `12` evidence-backed targets generated and imported
- `4` warm leads contacted
- `8` cold leads contacted
- `3` replies
- `2` discovery calls or sprint-intake starts
- `1` paid sprint or named pilot agreement

The operating goal is not awareness. The goal is the first booked Workflow Hardening Sprint.
