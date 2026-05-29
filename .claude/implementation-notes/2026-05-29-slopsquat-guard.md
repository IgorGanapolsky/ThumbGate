# Slopsquat guard — block hallucinated/typosquatted package installs

**Date:** 2026-05-29
**Branch:** `feat/slopsquat-guard`
**Context:** CEO directive to keep improving DS/ML/RAG and "learn from industry
trends + make money," autonomously. Second deliverable after the semantic-RAG PR
(#2380, merged + deployed).

## Research that drove the decision (deep research, then action)

1. First verified my initial thesis (cold-start = empty enforcement) was WRONG:
   a fresh install ships 36 hardcoded gates in `config/gates/default.json`, loaded
   unconditionally. So "no day-one value" is false. Good that I checked before building.
2. Pivoted to the real gap. Web research (Trend Micro, Aikido, Stanford AI Index 2026,
   nesbitt.io) converged on **slopsquatting** as the hottest 2026 agent supply-chain
   threat: ~20% of LLM-suggested packages don't exist; attackers register hallucinated
   names within hours; documented defense = intercept the install command and verify
   before it runs — exactly ThumbGate's PreToolUse mechanism.
3. Confirmed the codebase gap: `security-scanner.evaluateSecurityScan` only scans
   `Edit/Write/MultiEdit` (early-returns null for Bash). The `typosquat-suspect`
   detector runs only on package.json *content*, and NO gate pattern matches
   `npm install <pkg>` / `pip install <pkg>` Bash commands. Verified by enumerating
   `config/gates/default.json` patterns.

## Design decisions

- **Offline + deterministic in the hot path.** Bounded Levenshtein vs a bundled
  popular-package list (npm + PyPI). No network call when gating — honors local-first,
  latency, and the existing `deny-network-egress` gate. Online existence verification
  exists (`verifyPackageExists`) but is opt-in, separate, and fails open.
- **Integrated via evaluateSecurityScan, not a new default.json gate.** The security
  scan runs before gates in both `run` and `runAsync`; adding a Bash branch wires the
  guard into both paths with one change and reuses the deny/warn plumbing. Avoids
  touching `default.json` (smaller conflict surface).
- **False-positive safety is the hard part.** `preact` is distance-1 from `react` but
  legit. Mitigation: `KNOWN_LEGIT` allowlist = popular ∪ curated near-neighbors; a
  suspect is only flagged if NOT in that set. Distance-1 → critical (deny in block
  mode); distance-2 (len≥5) → high (warn). Default mode `block`, overridable to
  `warn`/`off` via `THUMBGATE_SLOPSQUAT_MODE`.
- **Severity → decision** reuses the scanner's existing convention (critical denies,
  high/medium warns), so behavior is consistent with the code-vuln scanner.

## Assumptions

- VERIFIED: gates-engine calls `evaluateSecurityScan(input)` for every tool in both
  sync and async paths; a non-null `deny` result short-circuits to a block.
- VERIFIED: popular-list typosquat detection blocks `npm install expres` end-to-end
  (`permissionDecision: deny`, "did you mean express?"), clean installs pass.
- UNVERIFIED (live tuning): the popular lists are a curated head, not exhaustive.
  Real-world typosquats against mid-tail packages won't match. This is intentional
  for v1 (precision over recall — avoid false-positive blocks); the registry-existence
  path is the documented follow-up for recall.

## Tradeoffs / rejected

- Rejected hard-blocking on registry non-existence in the hot path: needs network,
  adds latency, and a network failure would either block legit installs (fail closed)
  or silently pass (fail open). Kept it offline + opt-in instead.
- Rejected adding a regex gate to default.json: regex can't compute edit distance or
  consult an allowlist, so it would be all-or-nothing on install commands.

## Files

- `scripts/slopsquat-guard.js` (new) — parser + detector + Levenshtein + verify util.
- `scripts/security-scanner.js` — `evaluateSlopsquatScan` + Bash branch + export.
- `tests/slopsquat-guard.test.js` (new, 19 cases).
- `package.json` — `test:slopsquat-guard`, aggregate `test`, `files` whitelist entry.
- `tests/public-core-boundary.test.js` — file-count ceiling 264 → 265 (documented).
- changeset + this note.
