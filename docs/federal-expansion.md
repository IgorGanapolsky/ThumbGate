# ThumbGate Federal — Public/Core Split for Government Agencies

> Positioning brief + boundary contract for federal-agency deployment of ThumbGate.
> Adopted 2026-05-13. Read this before touching any `THUMBGATE_DEPLOY=gov` code path.

## TL;DR

**ThumbGate Federal is a Core-side deployment profile, not a fork or rewrite of the public shell.** The public `npm install thumbgate` dev product stays unchanged. Federal capabilities ship as additive layers inside `ThumbGate-Core`, gated behind `THUMBGATE_DEPLOY=gov` or a licensed Core binary.

One codebase. One brand. Two landing surfaces. The buyer journey is fundamentally different — federal procurement officers don't read `npm install` docs, they look for compliance badges, control mappings, and a "contact for pilot" CTA — but the underlying engineering invariant is *the public shell is the goose laying eggs and federal work cannot regress it*.

## Surface-by-surface boundary

| Surface | Public ThumbGate (unchanged) | ThumbGate-Core federal-gated (new) |
|---|---|---|
| `npm i thumbgate` CLI | ✅ identical | — |
| PreToolUse hooks, gate engine | ✅ identical | — |
| Feedback capture, lesson DB | ✅ identical | — |
| Railway SaaS dashboard | ✅ identical | — |
| Air-gapped deployment mode | — | ✅ new |
| Bedrock GovCloud / Azure Gov LLM routing | — | ✅ new (replaces Claude reranker when `THUMBGATE_DEPLOY=gov`) |
| FedRAMP audit log sink | — | ✅ new |
| NIST 800-53 control mapping report | — | ✅ new |
| Federal RAG (if/when an agency asks) | — | ✅ new |

## Non-negotiable invariants (regression tests must pin these)

These are the boundary contract. Every federal feature must satisfy all five. Violating any of these is a merge-blocking regression.

### Invariant 1 — Public install works with zero federal env vars

```bash
# On a fresh machine, with NO THUMBGATE_DEPLOY env var set:
npm install -g thumbgate
thumbgate --version    # must succeed
thumbgate test-block   # must succeed
```

Federal env vars MUST NOT be required for the public install to function. Pinned by `tests/public-core-boundary.test.js → no required THUMBGATE_DEPLOY env var in CLI bootstrap`.

### Invariant 2 — Public CI passes with Core absent

The default CI matrix runs without any Core API keys, Core binaries, or Core network calls. Integration tests that touch Core live in a separate opt-in workflow.

Pinned by existing `tests/public-core-boundary.test.js → no packaged file imports ThumbGate-Core` + `package.json does not depend on Core`.

### Invariant 3 — No federal code path reachable without explicit opt-in

Any federal-only code path (audit sink, GovCloud LLM routing, control-mapping report) must be unreachable unless either:

- `process.env.THUMBGATE_DEPLOY === 'gov'`, OR
- A licensed `@thumbgate/core` binary is loaded at runtime

Default execution path in the public package must NEVER hit federal-only code branches.

Pinned by `tests/public-core-boundary.test.js → public CLI codepaths gate gov features behind THUMBGATE_DEPLOY=gov`.

### Invariant 4 — Public bundle size does not grow from federal work

The npm bundle has a hard file-count ceiling (currently 260, see existing test). Federal work lives in `ThumbGate-Core` — adding federal source files to the public package directly is a violation. Measure before/after every Core release.

Pinned by existing `tests/public-core-boundary.test.js → npm bundle stays thin (file count ceiling)`.

### Invariant 5 — Dev-facing MCP tools behave identically in both modes

The `gate_stats`, `recall`, and `capture_feedback` MCP tools that developers use day-to-day must produce **bit-identical** output regardless of `THUMBGATE_DEPLOY` value. A developer running ThumbGate locally on their laptop and a contractor running the same dev workflow on a GovCloud instance must see the same response shapes from the same inputs.

Pinned by `tests/public-core-boundary.test.js → MCP tool surface stable across deploy modes`.

## The one risk to watch

**Scope creep where a "federal-only" feature leaks into public code because it's "easier."** That's how dual-market products rot. The boundary tests in `tests/public-core-boundary.test.js` are the enforcement mechanism — every federal feature needs a corresponding "this is not in public" regression test added to that file.

If you find yourself thinking *"I'll just put this small NIST helper in the public package, it's only 50 lines"*, stop. Put it in Core. The boundary is non-negotiable.

## Sequencing (respects both lanes)

1. **Federal positioning brief** (this doc) — no code touched in the public shell.
2. **Public-facing `/federal` landing page** — describes the federal lane factually, no feature promises that don't exist, "contact for pilot" CTA.
3. **Find pilot agency / SBIR contract.**
4. **When a pilot is signed:** build air-gapped mode in Core, behind `THUMBGATE_DEPLOY=gov`. Public shell unchanged.
5. **Only build federal RAG when the pilot agency names a corpus** — speculative RAG work without a buyer is wasted Core engineering.

## Buyer journey vs developer journey

| | Federal procurement officer | Open-source developer |
|---|---|---|
| Lands on | `/federal` | `/` |
| First question | *"Are you FedRAMP authorized?"* | *"Can I `npm install` this?"* |
| Conversion | Pilot contract / SBIR Phase I-II | `npm install` + `/checkout/pro` |
| Cycle | 3–18 months | 5 minutes |
| Channel | Direct + GSA + Carahsoft | Reddit / LinkedIn / Bluesky / npm |
| Decision unit | CIO + contracting officer + agency security | Individual developer |

These two journeys never need to cross. The same engineering team can serve both because the boundary protects each one from the other's failure modes.

## Compliance scaffolding (when a pilot is signed, not before)

Listed for awareness. **DO NOT BUILD ANY OF THIS WITHOUT A NAMED PILOT AGENCY.** Speculative compliance engineering is the fastest way to burn a year and not ship.

- **FedRAMP** (Federal Risk and Authorization Management Program) — the boss-level cert. Moderate or Low baseline depending on agency.
- **NIST SP 800-53 Rev 5** — control catalog FedRAMP maps to. ThumbGate's gate-based architecture maps cleanly to AC-3 (access enforcement), AU-12 (audit generation), CM-3 (configuration change control), SI-7 (software integrity).
- **NIST SP 800-171** — for CUI handling, simpler path than FedRAMP, often acceptable for DoD subcontractor work.
- **CMMC Level 2** — DoD-specific, ~110 practices.
- **StateRAMP** — state-government equivalent of FedRAMP.
- **TX-RAMP / AZ-RAMP** — state variants.

The right opening move is usually NIST 800-171 or CMMC L2 — they're faster to attest to than FedRAMP and unblock subcontractor work that's already procurement-friendly.

## Channels for federal acquisition

- **SBIR / STTR** — Small Business Innovation Research grants. ThumbGate's "stop AI agents from breaking production" pitch fits Phase I topics like AFWERX, ARL, DARPA. $50K–$250K Phase I, $500K–$2M Phase II.
- **GSA Schedule** — long sales cycle, but unlocks the buy-without-RFP path once on.
- **OTA** (Other Transaction Authority) — faster than traditional FAR contracts, used heavily by DoD innovation orgs.
- **Carahsoft / immixGroup / DLT Solutions** — federal resellers, take 5–15% margin but bring relationships.
- **GitHub Federal / Anthropic Federal partnership lane** — ThumbGate plugs into Claude Code / Cursor / Copilot. When those vendors have a fed deal, ThumbGate can ride along.

## Status (2026-05-13)

- Public shell at v1.18.0. `/go/teams` revenue flow live. ~$0/day federal-attributable revenue (no pilot signed).
- Core repo `IgorGanapolsky/ThumbGate-Core` exists per CLAUDE.md but no federal-specific code in it yet.
- No FedRAMP / NIST 800-171 / CMMC attestations in progress.
- This document and the `/federal` landing page are the **first deliverable** — positioning before engineering.

When a pilot lands, update this status section with: agency name, deployment mode, attestation track, target go-live date.
