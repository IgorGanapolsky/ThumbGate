# Autonomous reliability explorer (Antithesis-inspired)

Source inspiration:

- [Antithesis](https://antithesis.com/)
- [Deterministic simulation testing](https://antithesis.com/docs/resources/deterministic_simulation_testing/)
- [PE deepdive: How to debug large distributed systems](https://newsletter.pragmaticengineer.com/p/antithesis)

## How this improves the ThumbGate harness

Antithesis’s pitch: **verification is the bottleneck** when agents ship code fast.
They compress production-hardening into minutes via:

1. **Properties first** — assert what must never be false
2. **Fault injection** — clocks, toxic inputs, storage faults, secrets, rm -rf
3. **Deterministic simulation** — same seed → perfect replay
4. **Intelligent exploration** — search many scenarios, not one happy path
5. **RCA + repro** — stop chasing heisenbugs
6. **Fix new bugs fanatically** — promote findings into feedback/memory immediately

We **do not** run their hypervisor SaaS. We steal the **method** for local Node
reliability of gates + retrieval + feedback + audit.

| Antithesis idea | ThumbGate implementation |
|-----------------|---------------------------|
| Property-based testing | `scripts/reliability-invariants.js` |
| Fault injection | empty/corrupt memory, toxic/circular inputs, secrets, `rm -rf /`, scope mix, stub embedder |
| Deterministic replay | Seeded PRNG + fault schedule in report |
| Autonomous exploration | Multi-iteration `exploreReliability()` |
| Perfect repro | `node scripts/autonomous-reliability-explorer.js --seed=N` |
| Agent-friendly RCA | Markdown + JSON under `proof/` |
| New-bug fanaticism | `promoteFindings()` → feedback/memory JSONL for `feedback:rules` |
| Pre-merge Scenario #1 | `npm run prove:reliability` + self-heal check |

## High-ROI invariants (harness spine)

| ID | Why it matters |
|----|----------------|
| `gate-force-push-blocked` | Prevents history rewrite on main |
| `gate-rm-rf-blocked` | Prevents catastrophic FS wipe |
| `gate-secret-exfil-blocked` | Prevents secrets in shell history/process args |
| `gate-never-throws` | Gate crash = un-gated agent |
| `audit-never-throws` | Audit crash was a real prod-class bug (circular JSON) |
| `retrieval-scope-isolation` | No cross-tenant lesson leak |
| `feedback-schema-rejects-empty` | No noise → prevention rules |
| `replay-determinism` | Heisenbugs die |
| `findings-promoteable` | Explorer closes the feedback loop |

## Commands

```bash
# Interactive exploration
npm run explore:reliability
node scripts/autonomous-reliability-explorer.js --seed=42 --iterations=12 --promote

# CI / self-heal proof lane (fixed seed, bounded cost)
npm run prove:reliability
npm run explore:reliability:ci

# Unit tests
npm run test:autonomous-reliability
```

Env pins (self-heal uses these):

| Env | Default | Purpose |
|-----|---------|---------|
| `THUMBGATE_RELIABILITY_SEED` | `42` | Deterministic fault schedule |
| `THUMBGATE_RELIABILITY_ITERATIONS` | `8`–`10` | Bound CI cost |
| `THUMBGATE_PROOF_DIR` | `proof/` | Artifact root |
| `THUMBGATE_RELIABILITY_PROMOTE` | off | Force promote even on PASS |

## Self-heal integration

`scripts/self-healing-check.js` runs `prove_reliability` as a DEFAULT_CHECK with a
temp proof dir. A red health report means an invariant broke under fault injection —
fix before claiming the harness is HEALTHY.

## Real bug found by the explorer

Under fault `toxic-tool-input` (circular tool payload), `evaluateGates` threw:

`Converting circular structure to JSON` inside `audit-trail.recordAuditEvent`.

**Fix:** circular-safe `sanitizeToolInput` + safe stringify so gate evaluation
never crashes mid-audit.

That is the Antithesis value proposition: **find the bug nobody wrote a unit test for**,
with a seed-backed repro.

## Promotion → rules loop

On FAIL (and with `--promote`):

1. Explorer writes `proof/explorer-promotions/feedback-log.jsonl`
2. Writes matching `memory-log.jsonl` negative lessons
3. Operator (or CI artifact consumer) can feed into `npm run feedback:rules`

This implements PE’s “fix new bugs fanatically” without waiting for a human session.

## Limits (honest)

- Not a full-system hypervisor (no network/thread scheduling control)
- Does not replace unit/e2e coverage
- Complements gate eval + RAG IR metrics + pragmatic hybrid retrieval
- Explorer scripts stay **repo-local** (not in the public npm bundle ceiling)
