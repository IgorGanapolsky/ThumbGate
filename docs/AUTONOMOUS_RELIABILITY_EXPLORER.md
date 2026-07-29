# Autonomous reliability explorer (Antithesis-inspired)

Source inspiration: [Antithesis](https://antithesis.com/) and [deterministic simulation testing](https://antithesis.com/docs/resources/deterministic_simulation_testing/).

## How this helps ThumbGate

Antithesis’s pitch: **verification is the bottleneck** when agents ship code fast. They compress production-hardening into minutes via:

1. **Properties first** — assert what must never be false  
2. **Fault injection** — clocks, toxic inputs, storage/network faults  
3. **Deterministic simulation** — same seed → perfect replay  
4. **Intelligent exploration** — search many scenarios, not one happy path  
5. **RCA + repro** — stop chasing heisenbugs  

We **do not** run their hypervisor SaaS. We steal the **method** for local Node reliability of gates + retrieval + feedback.

| Antithesis idea | ThumbGate implementation |
|-----------------|---------------------------|
| Property-based testing | `scripts/reliability-invariants.js` |
| Fault injection | Empty/corrupt memory, toxic tool inputs, scope isolation, stub embedder, … |
| Deterministic replay | Seeded PRNG + fault schedule in report |
| Autonomous exploration | Multi-iteration `exploreReliability()` |
| Perfect repro | `node scripts/autonomous-reliability-explorer.js --seed=N` |
| Agent-friendly RCA | Markdown + JSON reports under `proof/` |

## Commands

```bash
npm run explore:reliability
node scripts/autonomous-reliability-explorer.js --seed=42 --iterations=12
npm run test:autonomous-reliability
```

## Real bug found by the explorer

Under fault `toxic-tool-input` (circular tool payload), `evaluateGates` threw  
`Converting circular structure to JSON` inside `audit-trail.recordAuditEvent`.  
Fixed by circular-safe `sanitizeToolInput` + safe stringify on audit append.

That is exactly the Antithesis value proposition: **find the bug nobody wrote a unit test for**, with a seed-backed repro.

## Limits (honest)

- Not a full-system hypervisor (no network/thread scheduling control)  
- Does not replace unit/e2e coverage  
- Complements gate eval + RAG IR metrics + pragmatic hybrid retrieval  
