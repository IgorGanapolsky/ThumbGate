# Greenberg Traurig pilot — procurement Q&A pack

**Status:** SKELETON — CEO must fill `[CEO TO CONFIRM]` placeholders before sending to Matt Beekhuizen's procurement team.
**For meeting:** 2026-05-28 3:00pm with Matt Beekhuizen (Chief Pricing & Innovation Officer, Greenberg Traurig)
**Use:** Hand-deliver this in the last 5 min of the demo, OR email immediately after as the post-demo follow-up. Pre-empts the 6-week procurement questionnaire by giving Matt's team the answers they were going to ask for.

**Before the meeting:** rehearse the conservative spoken answers in `docs/marketing/greenberg-traurig-ceo-answer-sheet.md`. This procurement pack still contains CEO/legal confirmation placeholders and should not be sent externally until those are resolved.

---

## Why this exists

Per 2026 BigLaw procurement norms (NatLawReview "85 Predictions for AI and the Law 2026," Asteros "Security questionnaires now have an AI section"), every AI vendor demo is followed by a security questionnaire from the firm's IT/risk/ethics teams. The top deal-killers in order:

1. Missing SOC 2 Type II report
2. Vague data-retention answer
3. No no-training guarantee on firm data
4. No IP + hallucination indemnification clause
5. No DPIA template (EU AI Act high-risk obligations live Aug 2026)
6. No BAA capability for health-vertical client matter
7. No 90 days of audit-log evidence that the policy is actually firing
8. Sandbox needs a sales gatekeeper to access

Vendors who answer these in the meeting collapse 6 weeks of back-and-forth into the same conversation.

---

## Q1: SOC 2 Type II report status

**[CEO TO CONFIRM]** — pick one of these honest options:

- **Option A (preferred if true):** "SOC 2 Type II report available under NDA today. Audit period: [DATES]. Auditor: [FIRM]. Happy to share once we have a mutual NDA in place."
- **Option B:** "SOC 2 Type II audit currently in progress. Type I report available under NDA today. Type II expected [Q3 / Q4 / 2027 Q1]. Audit firm: [FIRM]."
- **Option C (most honest if true):** "Pre-SOC2. We're a [N]-person startup. We can sign a contractual security commitment with the same control set ThumbGate enforces internally, and we'd offer a guided pilot under that commitment while we work toward Type II. We can introduce [SECURITY VENDOR / FRACTIONAL CSO] who is leading our SOC 2 prep."

**What kills the deal:** answering "we're working on it" without a concrete timeline or contractual alternative.

---

## Q2: Data retention + no-training guarantee

**Verified from CLAUDE.md and `/learn/regulated-agent-execution-boundary`:** ThumbGate's enforcement step is 100% local. The lesson DB is SQLite on the firm's infrastructure. Pro/Team tier *optionally* syncs anonymized rule patterns to Railway-hosted infrastructure; this is opt-out by default for regulated pilots.

**Verbatim answer:**
> ThumbGate's enforcement path is 100% local. The PreToolUse hook runs in-process inside the developer's agent runtime. The lesson DB (SQLite + LanceDB) lives on the firm's infrastructure. We see zero document content — only tool-call metadata. Zero-retention is the default contractual posture for the pilot. We can sign a no-training clause prohibiting use of any firm-derived data for model training on day one of the MSA.

---

## Q3: BAA capability

**[CEO TO CONFIRM]** — pick one:

- **Option A:** "Yes. We can execute a BAA under HIPAA today using [STANDARD BAA TEMPLATE / ATTORNEY-REVIEWED LANGUAGE]."
- **Option B:** "Not yet. Our current architecture is BAA-ready (local enforcement, no PHI egress) but we have not executed a BAA with a prior customer. We'd execute one for this pilot using [your firm's standard BAA template] subject to mutual legal review."

**What kills the deal:** "We don't sign BAAs." (For a firm with healthcare-vertical clients this is non-negotiable.)

---

## Q4: IP + hallucination indemnification

**[CEO TO CONFIRM]** — likely needs counsel to draft. Draft language placeholder:

> ThumbGate will defend, indemnify, and hold Client harmless against third-party claims that ThumbGate's enforcement infrastructure infringes a U.S. patent, copyright, or trade secret, subject to standard exclusions (combinations with third-party software, modifications by Client, use outside the agreed scope). Cap: [CAP $$$$$]. Excluded from any cap: confidentiality breaches, IP infringement, gross negligence.

**For hallucination specifically:** ThumbGate's product does not generate output — it gates output other models generate. The accurate framing is that ThumbGate's enforcement decisions are deterministic (pattern-match against firm-configured rules), so the indemnification scope is narrow.

---

## Q5: DPIA template (EU AI Act)

**Verified from research memo + CLAUDE.md:** EU AI Act high-risk obligations live Aug 2026. Any BigLaw firm with EU clients will request DPIA template.

**Verbatim answer:**
> We provide a DPIA template scoped to ThumbGate's processing footprint (tool-call metadata only, no document content, local enforcement, no cross-border transfer). Available under NDA. We have not been classified as high-risk under the EU AI Act because the system is a deterministic policy engine, not a model — but we provide DPIA language in case Client's legal/privacy review prefers an over-inclusive posture.

---

## Q6: 90 days of audit-log evidence

**Verified from `/ai-malpractice-prevention` live demos:** Sample audit-log JSON is downloadable today from the demo page (`Download audit JSON (sample)` button under each BLOCKED state) with ISO 27001 control mapping (A.5.10, A.5.14, A.5.24, A.5.34, A.8.10, A.8.24).

**Verbatim answer:**
> Sample audit JSON is downloadable from our demo page today. Each block decision includes `audit_id`, `rule.id`+`version`+`matched`, `blocked_call.agent`+`input_excerpt`+`matter_context`, `iso_27001_controls`, and a `generated_by` provenance field. Production version streams to your existing SIEM (Splunk, Sumo, CrowdStrike, Datadog, Wiz, or the 28 vendors in Anthropic's Compliance API ecosystem). The pilot will accumulate 90 days of logs against your firm-specific rule pack; happy to share an anonymized export at week 8 of the pilot for your security review.

---

## Q7: Sandbox access without sales gatekeeper

**Verified:** ThumbGate is open source on [GitHub](https://github.com/IgorGanapolsky/ThumbGate). `npx thumbgate init` brings up the full PreToolUse engine + starter rule set in <2 minutes.

**Verbatim answer:**
> ThumbGate's core enforcement engine is open source on GitHub. Your developer can install it locally today without a sales conversation: `npx thumbgate init` brings up the PreToolUse hook + starter rules. The hosted evidence dashboard and the legal-vertical rule pack (UPL detection, conflict-checker, privilege egress) are what the pilot adds on top. Sandbox-without-gatekeeper is the default posture, not an exception.

---

## Q8: Production deployment shape

**Verbatim answer:**
> Two deployment shapes, your choice for the pilot:
> 1. **Local-only (default for regulated pilots).** The PreToolUse hook + lesson DB run on each developer's machine inside Claude Code / Cursor / Codex / Gemini CLI / Amp / Cline / OpenCode / Claude Desktop. Zero cloud calls in the enforcement path. Audit logs stream to your firm's SIEM via [agent-side log shipper].
> 2. **Hybrid (optional).** Same local enforcement; lesson promotion + rule pack distribution happens through a ThumbGate-managed sync layer. Useful when the firm wants one rule pack to flow to 200 developers without manual distribution. Sync layer can be hosted in your tenant (BYO cloud) or in our infrastructure under standard MSA terms.

---

## Q9: Pricing for the 30-day pilot

**[CEO TO CONFIRM]** — research memo suggested $2,500–$7,500 enterprise pilot range. Pick one and commit:

- **Option A — Free pilot:** "30-day pilot is no-cost. We invest the engineering time on our side to author your firm-specific rule pack (UPL phrases your associates flag, your adverse-parties feed format, your privilege-marker conventions). Conversion to a paid annual agreement at end of pilot is optional, not contingent on the pilot being free."
- **Option B — Paid pilot:** "30-day pilot is $[$$$$$] flat-fee. Includes rule-pack authoring, 8 weeks of hosted evidence retention, weekly review meetings with [Igor / engineering counterpart]. Pilot fee credits 100% toward year-one annual subscription if you convert."

**What kills the deal:** discovery-phase pricing that requires Matt to call procurement for a custom quote. Innovation budgets in BigLaw are typically under $25K for evaluations; price-discoverable is critical.

---

## Q10: Post-pilot annual price

**[CEO TO CONFIRM]** — pick one:

- "Per-seat for the developer-runtime layer: $[X]/dev/month. Volume discounts at 50+, 200+, 500+ seats. Rule-pack subscription is included; hosted evidence dashboard is included; SIEM connector is included."
- "Practice-area flat-rate: $[Y]/quarter for the [intake / litigation / M&A / IP] practice area, capped seats. Best for firms piloting in one practice before going firmwide."

---

## CEO action items before tomorrow's demo

| # | Item | Status |
|---|------|--------|
| 1 | Confirm SOC 2 status answer (Q1 — pick A/B/C) | [ ] |
| 2 | Confirm BAA capability answer (Q3 — pick A/B) | [ ] |
| 3 | Confirm pilot pricing (Q9 — pick A/B + fill $$$) | [ ] |
| 4 | Confirm post-pilot pricing (Q10 — pick A/B + fill $$$) | [ ] |
| 5 | Have IP/hallucination indemnification draft language reviewed by [counsel] (Q4) — minimum: confirm we're willing to indemnify at all | [ ] |

If items 1–5 are confirmed by 2pm tomorrow, the procurement pack can ship as a 2-page PDF and be hand-delivered to Matt in the last 5 minutes of the demo. If not confirmed, hold this back and email it after Igor has the answers.

---

## Distribution

Once filled in, this lives at:
- `docs/marketing/greenberg-traurig-procurement-qa.md` (this file)
- (optional) `/pilot-security-pack` route as a public-facing surface — only if SOC 2 / BAA / pricing are all in the "honest yes" column

Do NOT publish this as a public page until **all `[CEO TO CONFIRM]` placeholders are resolved with verifiable answers.** Aspirational language on a public procurement page is a credibility risk if Matt's team Googles us.
