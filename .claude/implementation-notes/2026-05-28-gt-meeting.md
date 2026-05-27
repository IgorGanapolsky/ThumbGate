# Greenberg Traurig × ThumbGate — Demo Implementation Notes

**Meeting:** Thursday, May 28 2026, 3:00–3:30pm. Matt Beekhuizen (Chief Pricing & Innovation Officer, GT).
**Branch:** `claude/aimp-audit-download-2026-05-27`
**Demo surface:** https://thumbgate.ai/ai-malpractice-prevention (live, 200, schema-correct, 3 client-side demos verified BLOCKED/CLEARED end-to-end on 2026-05-27 18:43 UTC)

## Strategic frame (from deep research 2026-05-27)

**Matt's evaluation lens** (Chief Pricing & Innovation Officer, not just innovation): vendors are **overhead, not investments**. He's seen every Harvey / Spellbook / Vincent demo at least twice. Demo cannot out-feature them — must out-position as **the runtime layer underneath them**, not as another agent.

**The wedge:** Sullivan & Cromwell apologized to a federal judge in early 2026 for hallucinated citations despite having governance policies, two mandatory training modules, and verification requirements. Gordon Rees (Am Law 71) same problem on a bankruptcy filing. Damien Charlotin's database now catalogs **1,369+ AI hallucination decisions**. Every competitor sells the agent. ThumbGate sells "the thing that would have stopped S&C." That is the 90-second opener.

**Anthropic context (2026-05-25):** Anthropic shipped 28 passive monitoring integrations (Cloudflare/CrowdStrike/Datadog/Wiz etc) over Claude Enterprise conversation + activity logs — SIEM/DLP/observability AFTER the fact, NOT runtime gates. Separately (Fortune, May 12) shipped a Claude legal plug-in going direct to BigLaw. Runway tighter than thought; wedge still open because neither shipment touches PreToolUse runtime enforcement for developer agents.

## What competitors are actually showing (2026)

| Vendor | Demo lead | Format |
|---|---|---|
| Harvey | Practice-area assistants + LAB benchmark; DLA Piper 5K-seat rollout social proof | Sandbox tour, pre-built agents on synthetic deal data |
| Spellbook | Playbook Engine in MS Word, auto-flags "Aggressive Indemnity" | Word add-in on hostile NDA |
| Lexis+ AI / Vincent (vLex) | Citation-grounded research with verifiable cites | Workflow simulation across Westlaw/iManage/Outlook |
| Robin AI | Private-cloud SOC2/GDPR vertical contract review | Sandbox on customer's contracts |
| Anthropic Claude legal plug-in | Direct-to-BigLaw threat | Branded as part of Claude Cowork |

## Top deal-killers (in order)

1. **Missing SOC 2 Type II.** "Working toward" = dead.
2. **Vague data-retention** — must be contractual zero-retention, not blog post
3. **No no-training guarantee** on firm data
4. **No IP + hallucination indemnification** clauses
5. **No DPIA template** (EU AI Act high-risk obligations live Aug 2026) + no BAA capability
6. **No 90-day audit-log evidence** that the policy is actually firing (procurement now demands this explicitly per NatLawReview)
7. **Sandbox needs a sales gatekeeper** — can't self-serve = red flag

## Five concrete changes for <12-hour ship list

### 1. Downloadable audit-export button under every BLOCKED state on `/ai-malpractice-prevention`
- Filename: `ThumbGate-Audit-Sample-2026-05-28.pdf` (or `.json` if PDF tooling not in-repo)
- Fields: hook name, ISO 8601 timestamp, blocked tool call, rule ID + version, reviewer field, ISO 27001 control mapping
- Implementation: client-side Blob download, no new API route. Honest framing: "this is the JSON your SIEM ingests in production."

### 2. Sullivan & Cromwell 15-second opener
- Slide or talking point: "S&C had the policies. They didn't have the runtime gate. That's what we are." Then to UPL demo.
- Source: ComplianceHub article on 2026 legal-AI hallucination reckoning.

### 3. Conflict adverse-party demo: swap Acme/TechNova/Rivera for GT-shaped names
- GT just closed Enter's $100M Series B (Latin America AI unicorn) per PRNewswire 302767169.
- Demo adverse list should look like a Latin-America real-estate / hospitality / AI deal pattern — generic enough to be clearly fictional, specific enough to look like *their* docket.
- Suggested swap: "Latam Real Capital S.A. de C.V." (real estate), "Hospitalia Holdings" (hospitality M&A), "NovaIA Latam" (AI). Numbers stay fictional.

### 4. "Show me the rule that fired" panel
- Already partially present in the inline `<div class="audit-log">` markup.
- Make more prominent. Spellbook's framework explicitly demands "Chain of Thought + which playbook rules triggered." Be the only vendor in the room who shows it deterministically, not as LLM rationalization.

### 5. Trim 5-min "deployment + reviewer roles" to 3 min, add 2-min "what your security questionnaire will need"
- One-pager: SOC 2 Type II status (honest current state, not aspirational), retention posture, no-training clause text, indemnification draft language, DPIA template link.
- Pre-empting the post-demo questionnaire collapses 6 weeks of procurement into one meeting.

## Three probable Matt questions + verbatim ≤50-word answers

**Q1: "How is this different from Harvey's guardrails or Anthropic's Claude legal plug-in?"**
> They are model providers; we are the runtime gate underneath. We don't compete with Harvey — we make Harvey safer to deploy. The PreToolUse hook fires deterministically before the LLM call, in-process, with an immutable audit log. That's what S&C's policies couldn't do.

**Q2: "Where does our privileged data go? What's your retention?"**
> Nowhere. ThumbGate runs in-tenant; the lesson DB is local SQLite on your infrastructure. We see zero document content — only tool-call metadata. Zero-retention is contractual, not a setting. We can sign a no-training clause and BAA today.

**Q3: "What's the integration cost and time-to-first-block?"**
> One config file in your Claude Code or Cursor deployment. First block fires within 10 minutes of install — the UPL rules and privilege-egress rules ship pre-loaded. Custom firm-specific rules typically take a partner 30 minutes to author. No model retraining, no IT ticket.

## Calibrations against the marketing pitch (audited 2026-05-27)

The pitch sentence "human attorneys deterministically create enforceable safety gates and simultaneously train a proactive RL model for legal efficiency, all 100% locally with zero cloud data calls for enforcement" — three calibrations:

- **Pillar 1 (deterministic gates from thumbs-down):** ✅ substantially true. Threshold-based promotion is the default (Thompson Sampling needs ≥3 incidents). If Matt wants single-shot, that's a config flag. Either change config for pilot or soften wording to "after a small number of consistent flags."

- **Pillar 2 (Thompson Sampling = RL model routing to cheapest path):** ⚠️ **over-claims.** Our Thompson Sampling is a rule-selection bandit, not a model/path/cost router. There is no LLM router. If Matt asks "show me the cost-savings dashboard from the RL model picking the cheaper path," we don't have it. **Soften to:** "the lesson DB statistically reinforces patterns attorneys approved, so future actions converge toward the workflows your firm endorsed." "Saves token cost" is true via fewer retries + fewer blocked actions, not cheap-model routing.

- **Pillar 3 (100% local, zero cloud calls for enforcement):** ✅ true with footnote. Gate decision is 100% local. Pro/Team tier *optionally* syncs anonymized rule patterns to Railway (lesson sync, not enforcement path). **Pre-empt:** "the enforcement step never leaves your environment; Pro tier optionally syncs anonymized rule patterns across team machines, which we'd disable by default for your pilot."

## Sources

- [Harvey Legal Agent Bench launch](https://www.artificiallawyer.com/2026/05/06/harvey-launches-legal-agent-bench/)
- [Spellbook 2026 vendor evaluation framework](https://spellbook.com/learn/how-to-evaluate-legal-ai-vendors)
- [Orbital — Legalweek 2026, Beekhuizen quotes](https://www.orbital.tech/blog/legalweek-2026)
- [Fortune — Anthropic legal plug-in, BigLaw all-in despite hallucinations](https://fortune.com/2026/05/12/anthropic-legal-plug-in-release-claude-cowork-big-law/)
- [ComplianceHub — 2026 hallucination reckoning incl. Sullivan & Cromwell](https://compliancehub.wiki/legal-ai-hallucination-reckoning-2026/)
- [Damien Charlotin AI Hallucination Cases Database — 1,369+ rulings](https://www.damiencharlotin.com/hallucinations/)
- [NatLawReview — 85 Predictions for AI and the Law 2026 (procurement hardening, 90-day evidence)](https://natlawreview.com/article/85-predictions-ai-and-law-2026)
- [Asteros — security questionnaires now have AI sections](https://asteros.com/2026/05/your-security-questionnaire-now-has-an-ai-section-most-teams-are-not-ready/)
- [ACC April 2026 AI Playbook for In-House Teams](https://www.acc.com/sites/default/files/2026-04/The-AI-Playbook-Putting-AI-to-Work-for-In-House-Legal-Teams.pdf)
- [Anthropic 28 security/compliance integrations — HelpNetSecurity 2026-05-25](https://www.helpnetsecurity.com/2026/05/25/anthropic-security-compliance-integrations-claude/)
- [Beekhuizen profile — Greenberg Traurig](https://www.gtlaw.com/en/professionals/b/beekhuizen-matthew-n)
- [GT represents Enter $100M Series B](https://www.prnewswire.com/news-releases/greenberg-traurig-represents-enter-in-100m-series-b-creating-latin-americas-first-ai-unicorn-302767169.html)

## VERIFIED facts (timestamp 2026-05-27 18:43 UTC)

- `https://thumbgate.ai/ai-malpractice-prevention` returns HTTP 200, schema-correct, both reference pages (`/agents-cost-savings`, `/codex-enterprise`) return 200.
- All 3 live demos return correct BLOCKED on triggering inputs, correct CLEARED on safe inputs. Tested headlessly with full script context.
- The 25-min agenda card on `/ai-malpractice-prevention` matches the 30-min Google Meet slot (5 min slack).

## UNVERIFIED assumptions (need CEO confirmation before demo)

- Greenberg Traurig has Claude Code / Cursor / Codex in use in any practice area. We're assuming the entry point is an AI intake bot, but Matt may want to scope to a different workflow.
- SOC 2 Type II status — **what should we say?** If we're not Type II certified, the honest answer is "Type I in progress, Type II audit scheduled for Qx" — and we need to know the right Qx number.
- BAA capability — can we actually sign a BAA today? If not, the verbatim Q2 answer needs revising.
- Indemnification — what's our actual draft language? If we don't have one, the security-questionnaire one-pager promises something we can't deliver.

## Open follow-up

- This file is the source of truth for tomorrow's prep. Update it as we ship changes.

---

## Demo speaking notes — 2026-05-28 3:00–3:30pm ET

**Open this file at 2:55pm. Read minute-by-minute. Numbers in `[brackets]` are clock checkpoints.**

### `[3:00]` Open — 90 seconds, do not skip

> *"Matt, thanks for the time. Before I share my screen — one thing to anchor the conversation. Sullivan & Cromwell apologized to a federal judge earlier this year for AI-hallucinated citations. They had governance policies. They had two mandatory training modules. They had verification requirements. They still got sanctioned. Gordon Rees, same problem on a bankruptcy filing. The public hallucination-cases database — Damien Charlotin maintains it — now catalogs over thirteen hundred rulings. So the question for Greenberg today isn't 'should we have an AI policy.' You already do. The question is whether enforcement runs on the model's good intentions or on something deterministic outside the model context. That's what I want to show you in the next twenty-five minutes."*

Share screen → `https://thumbgate.ai/ai-malpractice-prevention`. The S&C callout is the first thing visible.

### `[3:02]` Set scope — 3 minutes

> *"Quick framing: ThumbGate isn't another research assistant. It's the pre-execution control layer around whatever assistants and agents Greenberg already wants to evaluate. We don't replace Harvey or Lexis+ AI or Anthropic's plug-in. We run underneath them. The boundary is PreToolUse — the moment after the model proposes a tool call, before the tool actually fires. The gate runs deterministic pattern-match logic in-process, no LLM in the decision path, no cloud call for the enforcement step. Anthropic published last week that monitoring is a category — they shipped twenty-eight passive integrations into SIEMs. We're the other half: the runtime gate that fires before the harm. SIEM is the audit trail. PreToolUse is the prevention."*

Pause. Let Matt either nod or interject.

### `[3:05]` Live demo 1 — UPL Gate — 3 minutes

Scroll to the "Live gate demos" section. Click into the UPL input.

> *"This is a fake intake bot. A prospective client types a question. The model wants to give legal-shaped advice. Watch what happens."*

Paste: `Based on the facts you described, you likely have a strong claim for breach of contract and should sue immediately.`
Click **Run through UPL Gate**.

Result: BLOCKED card fires with the audit log.

> *"Detected pattern: 'based on the facts you described.' Not because the model decided it was risky — because the deterministic gate matched a pattern your ethics team would have flagged anyway. Action taken: block the advice, replace with a redirect to a licensed attorney. Audit ID, rule version, agent identity all logged. And — this matters for procurement — every blocked action ships a downloadable JSON your IT team can ingest into Splunk or Sumo with ISO 27001 control mapping pre-attached."*

Click the **Download audit JSON (sample)** button. The file downloads. Note this verbally.

> *"That JSON is what your security team gets to inspect after every block. Production version streams to whatever SIEM your firm already uses."*

### `[3:08]` Live demo 2 — Conflict Gate — 3 minutes

Scroll to conflict input (pre-filled `Latam Real Capital S.A.`). Click **Check Against Adverse List**.

Result: BLOCKED — matches adverse party in matter M-2847.

> *"Same architecture, different rule. The sample adverse list here is synthetic — Latam Real Capital, Hospitalia Holdings, NovaIA Latam — but it's deliberately shaped like the kind of cross-border AI / real-estate / hospitality docket Greenberg actually runs. In production we'd ingest your firm's real adverse-parties feed. The gate then checks every proposed agent action — fetching documents, scheduling intake, sending email — against that list before the action fires. Conflict-precheck stops the agent before any sensitive facts are collected from the prospect."*

Then click again with a non-adverse name (e.g., `Smith Industries`) — show CLEARED.

> *"Positive clearance gets logged too. Reviewable evidence that the check ran, not just that it didn't block."*

### `[3:11]` Live demo 3 — Egress Gate — 3 minutes

Scroll to privilege input. Paste: `Please summarize this deposition transcript. [Attorney Work Product - Matter M-2847 - Confidential]`
Click **Attempt External LLM Call**.

Result: BLOCKED — detected privilege marker.

> *"Attorney work product marker, matter ID. Gate blocks the outbound LLM call, redirects to an in-tenant Azure OpenAI deployment or your internal summarizer. The privileged content never leaves your perimeter. Audit log captures the content hash, not the content itself."*

Pause for the impact.

> *"That's the third failure mode. Same architecture, different rule set."*

### `[3:14]` "Why this is different" — 4 minutes

Scroll up to "Why this is credible now" section.

> *"Three things separate this from the agent-observability category Anthropic and their twenty-eight SIEM partners just defined. One: enforcement runs in your environment, not theirs. The lesson DB is local SQLite — no document content ever leaves the firm's perimeter for the gate decision itself. Two: it's deterministic. A model-judge would cost you ten times the inference bill, can't make audit-grade decisions, and adds latency to every agent action. Pattern-match doesn't. Three: it's agent-agnostic. The same rule pack runs in Claude Code, Cursor, Codex CLI, Gemini CLI, Sourcegraph Amp, Cline, OpenCode, and Claude Desktop. Whichever vendor your associates pick this quarter, the gates follow."*

### `[3:18]` Pilot mechanics — 5 minutes

Scroll to "Recommended 30-day pilot."

> *"The pilot shape we'd propose: one practice area, one workflow, your firm-specific rule pack authored on our side from your ethics team's existing policy language. We pre-load the rules before the first intake simulation — the agent doesn't get to discover them. We prove that proposed actions are physically stopped against the pack. Reviewable evidence at the end."*

Specific asks (script):

> *"What we'd need from you to scope this: one practice-area workflow we'd target — intake, conflict-check, document review, your call. One approved disclaimer text. One synthetic adverse-parties fixture — no real client data. One security contact who can sign the standard pilot agreement. We'd build the rule pack on our side, drop it into a sandbox of your firm's choosing, and run a no-client-data simulation. End of pilot, you'd have a structured audit export, a list of what fired and why, and a write-up your innovation team can present internally."*

### `[3:23]` Open the procurement door — 2 minutes

> *"One last thing — I know what comes after a meeting like this. Your IT and risk team will send a security questionnaire. SOC 2, retention, no-training clause, indemnification, DPIA, BAA. I have a one-pager with our answers ready. Want me to email it to you and your security contact tonight, so your team has it Monday morning without a six-week back-and-forth?"*

**If yes:** the procurement Q&A in `docs/marketing/greenberg-traurig-procurement-qa.md` ships as a 2-page PDF tonight. CEO must resolve the `[CEO TO CONFIRM]` blanks by 5pm today.

**If no / Matt deflects:** *"Understood — happy to send it when your team is ready to ask."* No push.

### `[3:25]` Wrap — 3 minutes

> *"That's the demo. To summarize the ask: one workflow, one disclaimer, one synthetic fixture, one security contact, permission to build a no-client-data pilot pack. If that lands, we'd plan a thirty-day pilot starting whenever your team has bandwidth. I'll send a one-page recap and the procurement pack tonight. Any questions before we wrap?"*

Q&A. Three pre-baked answers:

| Question | Verbatim answer (≤50 words) |
|---|---|
| Q: How is this different from Harvey's guardrails or Anthropic's legal plug-in? | "They are model providers; we are the runtime gate underneath. We don't compete with Harvey — we make Harvey safer to deploy. The PreToolUse hook fires deterministically before the LLM call, in-process, with an immutable audit log. That's what S&C's policies couldn't do." |
| Q: Where does our privileged data go? Retention? | "Nowhere. ThumbGate runs in-tenant; the lesson DB is local SQLite on your infrastructure. We see zero document content — only tool-call metadata. Zero-retention is contractual, not a setting. We can sign a no-training clause and BAA today." |
| Q: Integration cost and time-to-first-block? | "One config file in your Claude Code or Cursor deployment. First block fires within ten minutes of install — UPL and privilege-egress rules ship pre-loaded. Custom firm-specific rules typically take a partner thirty minutes to author. No model retraining, no IT ticket." |

### `[3:30]` Close

> *"Matt, thanks. I'll send the recap, the procurement pack, and the link to the demo within the hour. Looking forward to your team's feedback."*

---

## Things to NOT do during the demo

- Don't open the github.com repo — it reads "engineering demo," not "BigLaw vendor."
- Don't quote sanctions statistics you haven't sourced live in the call.
- Don't promise SOC 2 Type II if it's not done — say what's true (see procurement Q&A).
- Don't say "we have" any feature beyond what's on the live page. The demo IS what's shipped.
- Don't pitch pricing without naming a specific number first (per memo — discovery-phase pricing kills BigLaw deals).
- Don't reach for the dashboard at `/dashboard` — it's analytics-shaped, not lawyer-shaped.
- Don't mention this is open source unless Matt asks. He's buying hosted infrastructure + adapter coverage + support, not access to the code.

---

## What to send at `[3:31]` from the CEO's email account

Subject: *ThumbGate × Greenberg Traurig — recap and procurement pack*

Body (fill blanks before sending):

> Matt,
>
> Thanks for the time today. As discussed:
>
> 1. Demo recap: [https://thumbgate.ai/ai-malpractice-prevention](https://thumbgate.ai/ai-malpractice-prevention) — the live gate demos and the 25-minute pilot agenda.
> 2. Procurement pack — answers to SOC 2, retention, no-training, indemnification, DPIA, BAA, audit-log evidence, sandbox access. Attached as a 2-page PDF, also included inline below.
> 3. The pilot scope we'd propose: [one specific workflow Matt named] in [practice area], using [approved disclaimer placeholder], with [synthetic adverse-list fixture]. No client data, no production agents in the loop until your security review signs off.
>
> Next step ask: introduction to your security contact this week so they can review the pack before we get on a follow-up. Happy to defer if your team needs longer.
>
> Best,
> Igor
