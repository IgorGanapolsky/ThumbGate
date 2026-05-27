---
"thumbgate": patch
---

site: `/ai-malpractice-prevention` — add downloadable audit JSON to each gate demo + Greenberg Traurig–shaped adverse-parties

Two surgical improvements to the live legal-vertical demo surface before the 2026-05-28 Greenberg Traurig pilot meeting.

**1. Downloadable audit JSON under every BLOCKED state.** The 25-minute agenda card on the page already promises *"one audit export with rule version, source, outcome, and reviewer"* — the demos previously only printed an inline audit-log string with no downloadable artifact. Adds a "Download audit JSON (sample)" button under each of the three BLOCKED branches (UPL, Conflict, Egress). The JSON shape includes ISO 27001 control mapping (A.5.10, A.5.14, A.5.24, A.5.34, A.8.10, A.8.24) so a procurement reviewer can map evidence to controls without translation. Honest framing in the payload's `generated_by` field: *"production version streams to your SIEM."* Pure client-side `Blob` download — no new API route, no server dependency, no test impact.

**2. Adverse-parties list reshaped to look like a real Greenberg Traurig matter.** Swapped the generic `Acme Corp / TechNova Inc / Rivera Holdings` synthetic names for `Latam Real Capital S.A. / Hospitalia Holdings / NovaIA Latam` — a Latin-America real-estate / hospitality / AI deal pattern that mirrors GT's recent docket (e.g. GT just represented Enter on a $100M Series B creating Latin America's first AI unicorn per PRNewswire 302767169). Demos that look like the prospect's own deal flow convert better than generic ones. All names are explicitly fictional; the page's caption now reads *"(synthetic, illustrative)"* to keep the framing honest.

Also includes `.claude/implementation-notes/2026-05-28-gt-meeting.md` per CLAUDE.md's implementation-notes mandate — full demo prep memo including five concrete agenda improvements, three probable Matt Beekhuizen questions with verbatim ≤50-word answers, top deal-killers in order, three-pillar pitch calibrations (Pillar 2 over-claims Thompson Sampling as a model router — softened), and `VERIFIED` vs `UNVERIFIED` assumptions list.

Headless verification (window=global Node sandbox): all 3 demos correctly return BLOCKED on triggering inputs + CLEARED on safe inputs, all 3 download buttons fire with correct filenames, JSON shape includes all required fields. 39/39 `public-static-assets.test.js` still green.
