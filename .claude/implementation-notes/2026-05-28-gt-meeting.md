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
