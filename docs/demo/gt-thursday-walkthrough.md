# Greenberg Traurig — Thursday Walkthrough Script

**Audience:** Matthew N. Beekhuizen, Chief Pricing and Innovation Officer, Greenberg Traurig
**Date:** 2026-05-28 (Thursday)
**Duration:** 25 minutes (target)
**Goal:** Land a paid pilot on one Greenberg Traurig intake workflow.

---

## Pre-flight checklist (run morning of)

```bash
# 1. Patterns fire on realistic intake transcripts.
node scripts/demo/legal-gate-pattern-proof.js
# Expect: 60/60 expectations met across 10 scenarios.

# 2. Enforcement does not leak network traffic.
bash scripts/demo/zero-egress-proof.sh
# Expect: PASS — gate fired AND no new outbound connection opened.

# 3. Dashboard demo mode renders the legal-intake story.
open https://thumbgate-production.up.railway.app/dashboard?demo=1
# Expect: badge reads "Demo Mode — Jamie M., Partner · Litigation Intake".
# Stats: 184 / 91 / 93 / 14. Active Gates panel shows UPL, conflict, egress.
```

If any check fails, **do not run the demo as designed.** Either re-stage the failing surface or fall back to slides for that pillar.

---

## The pitch in one sentence

ThumbGate gives GT's innovation, pricing, risk, and attorney teams a pre-execution control layer around legal AI workflows: firm-approved rules run before an agent replies, fetches records, schedules intake, or sends data outside the firm's approved boundary.

Three pillars: **deterministic safety gates** (the kill switch), **reviewable control evidence** (the pricing/innovation proof), **local-first enforcement** (privilege protection).

---

## Talk track

### 0:00 – 2:00 — The expensive question (slides)

Open on a slide showing one intake transcript:

> Prospect: "Hi, I was fired last week in Florida. Can I sue my employer?"
> AI intake agent: "Based on what you've described, you likely have a strong case for wrongful termination. You should file in the Southern District of Florida."

Two sentences. This is the pattern to avoid: advice-shaped output from a non-attorney intake agent before conflict clearance, supervision, and approved disclaimers. Do not quote firm-specific exposure numbers. Anchor on ABA Rule 5.5, confidentiality, supervision, and the fact that policies alone do not enforce themselves.

> "Most AI safety tools would have caught this *after* it landed in the prospect's inbox. We catch it before the call returns."

### 2:00 – 4:00 — Why memory isn't enough (slides)

Most "agent memory" tools store this incident, retrieve it later, and *hope* the model behaves differently next time. Hope is not a control.

ThumbGate's mechanism is different: a thumbs-down doesn't write a note — it compiles a **deterministic PreToolUse gate** that fires and logs on the next matching tool call before it executes, and hard-blocks it for the critical classes (privileged egress, conflicts, UPL routed to attorney review). The attorney's hand is on the kill switch, but the switch is deterministic — it doesn't rely on the model remembering.

Transition: "Let me show you what that looks like."

### 4:00 – 12:00 — Pillar 1: Deterministic Safety Gates (dashboard + CLI)

Open `/dashboard?demo=1` in browser. Badge reads **"Demo Mode — Jamie M., Partner · Litigation Intake."**

**Walk the screen:**
- **Top row:** 184 intake events, 91 safe, 93 blocked, 14 active gates.
  Frame: "This is a 30-day window across two intake agents in this firm — one in production, one in a litigation-practice pilot."
- **Top Blocked Gates panel:** UPL (34), Conflict Clearance (22), Privileged Egress (17), Disclaimer (11), Model Endpoint (6), Attorney Review (3).
  Frame: "Every row is a malpractice avoidance event. The UPL row is the screenshot we opened with — 34 times this month, agents tried to predict outcomes; 34 times we stopped them."
- **Recent Memories panel:** Click into the entry titled *"Intake agent provided outcome prediction to prospect."* Show the ABA Rule 5.5 tag and the BLOCKED decision routed to attorney review.

**Now make a gate live, in front of him.** Switch to a terminal:

```bash
# 1. Show the gate exists.
node -e "
  const t=require('./config/gate-templates.json').templates.find(x=>x.id==='block-unauthorized-practice-of-law');
  console.log('Rule:', t.name);
  console.log('ABA:', 'Rule 5.5');
  console.log('Pattern:', t.pattern);
"

# 2. Evaluate the same UPL-shaped reply the slide opened with.
bash scripts/demo/zero-egress-proof.sh
```

The output shows `result: BLOCKED — denied — routed to attorney review queue`. This is the kill switch firing in real time.

Then **show the thumbs-down creating a new gate** (use the dashboard's existing capture flow if connected, or describe the capture-feedback CLI):

```bash
node .claude/scripts/feedback/capture-feedback.js \
  --feedback=down \
  --context="Intake agent suggested venue in employment matter" \
  --what-went-wrong="Jurisdictional recommendation crosses Rule 5.5" \
  --what-to-change="Block any reply containing venue or filing recommendation" \
  --tags="upl-risk,aba-rule-5.5,jurisdiction"
```

Frame: "Jamie just authored a hard rule. Without writing code. Without sending the transcript to OpenAI to be 'analyzed.' The rule is in the local lesson DB now. Every future agent in this firm is bound by it."

### 12:00 – 17:00 — Pillar 2: Proactive Efficiency (dashboard)

Switch back to dashboard. Scroll to the **Predictive Insights** card.

- **Forecast revenue:** $84,000 booked + $32,000 incremental opportunity.
- **Top creator:** innovation_team — $48,000.
- **Top source:** direct_outreach — $24,000.
- **Upgrade propensity:** Pro 0.84 (high), Team 0.72 (high).

Frame: "This isn't just blocking. The same feedback loop that creates the kill switch also records which intake routes, disclaimers, escalation paths, and review decisions worked. That gives an innovation and pricing team better predictability: which workflows are safe enough to scale, which need attorney review, and which should remain out of bounds."

Show the **Insights pipeline** card:
- Intake Events 184 → Rules Refined 42 → Gates Active 14 → Risks Prevented 93.

Frame: "Every thumbs-up reinforces a good routing path. Every thumbs-down compiles a gate. The two loops feed each other — and neither calls out to the cloud."

### 17:00 – 22:00 — Pillar 3: Zero Cloud Egress (terminal)

The privilege-protection pillar. Run the proof in a fresh terminal:

```bash
bash scripts/demo/zero-egress-proof.sh
```

The output shows:

```
--- Outbound connections BEFORE gate evaluation ---
  count_before=0

--- Gate evaluation (local-only, no cloud call) ---
  gate:      block-unauthorized-practice-of-law
  result:    BLOCKED

--- Outbound connections AFTER gate evaluation ---
  count_after=0

--- Verdict ---
  connections_opened_during_enforcement = 0
  PASS: gate fired AND no new outbound connection opened.
  Privileged data did not leave the firm boundary during enforcement.
```

Frame: "Most AI safety wrappers have to send the prospect's prompt *and* the proposed AI action up to a third-party judge model before deciding to block it. That's an egress event for privileged data. Ours isn't. The SQLite + LanceDB index lives inside your environment. The enforcement decision is local. The audit trail is local. If your CISO has us on a network diagram, the only line is from your intake system into your tenant — never out."

Optional (if asked): show that the lesson DB is a single SQLite file you can put behind your existing DLP boundary, and that the embedding store is on-disk, no vector cloud.

### 22:00 – 25:00 — The pilot ask

The number to land on:

> **30-day legal AI governance pilot — one Greenberg Traurig intake workflow — $2,500–$7,500 flat, scope-dependent.**
> By the end of the pilot you have: a preloaded no-client-data rule pack, synthetic adverse-party fixture, blocked-action demos, local-first enforcement proof, sample audit export, security/data-flow note, pilot metrics, and a go/no-go rollout recommendation.
> If the pilot is useful, the next commercial discussion is a scoped Team rollout or practice-area expansion. Do not lead with self-serve checkout or per-seat pricing on the first call.

Stop talking. Let him respond.

---

## Backup answers (rehearse before)

**"How do I know your patterns catch the next UPL phrasing nobody's seen yet?"**
Two answers: (a) Thompson Sampling generalizes from approved/rejected patterns — every blocked malpractice phrasing biases the model away from the next variant. (b) For the catastrophic cases (Rule 5.5, 1.6, 1.7), the deterministic regex is the floor, not the ceiling — your attorney supervisors author additional rules whenever they see one.

**"What's the failure mode if a gate blocks something it shouldn't?"**
Soft block by default at "warn" severity for new rules; hard block at "critical." Every block routes to the attorney review queue with the matched rule and the proposed reply. Reviewer can override in one click, which feeds back into the RL layer as a thumbs-up — so false positives are an *input* to the system, not a regression.

**"Are you SOC 2? GDPR? HIPAA?"**
Honest answer per `docs/COMMERCIAL_TRUTH.md`: "We don't claim sub-processor coverage, SOC 2, HIPAA eligibility, or GDPR DPA terms until those legal artifacts are actually in place." For the pilot we ship as a local install inside your tenant, which sidesteps most of those questions until the hosted Team contract.

**"What if your company disappears?"**
The gate engine is MIT-licensed and your gates are flat-file JSON. Worst case, you keep running it. We make money on hosted state management, adapter compatibility against the underlying agent platforms (Claude, GPT-5, Cursor, Gemini), and the workflow-hardening sprint expertise. None of those lock the firm in.

---

## What this demo deliberately does NOT do

- **Does not** require Greenberg Traurig credentials for any cloud system during the demo. The pitch is local; the demo proves local.
- **Does not** claim integrations we haven't shipped. The "in-tenant CRM reroute" is a roadmap line in the sprint, not a live feature.
- **Does not** quote firm-specific financial numbers. The $48K and $24K on the dashboard are illustrative pilot-scale figures, not Greenberg-specific projections.

---

## Post-meeting (whatever happens)

```bash
# Log the outcome to the lesson DB so future demos benefit.
node .claude/scripts/feedback/capture-feedback.js \
  --feedback=up \
  --context="GT walkthrough on 2026-05-28 with Matt Beekhuizen" \
  --what-worked="<fill in: which pillar landed hardest>" \
  --tags="gt-pilot,legal-vertical,demo-postmortem"

# OR
node .claude/scripts/feedback/capture-feedback.js \
  --feedback=down \
  --context="GT walkthrough on 2026-05-28 with Matt Beekhuizen" \
  --what-went-wrong="<fill in: which pillar fell flat>" \
  --what-to-change="<fill in: specific demo change for next BigLaw run>" \
  --tags="gt-pilot,legal-vertical,demo-postmortem"
```
