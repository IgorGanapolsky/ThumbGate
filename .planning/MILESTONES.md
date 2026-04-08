# Milestones

## v2.0 — Production Readiness (Complete)

**Shipped:** 2026-03-04
**Phases:** 6-12 (7 phases, 27 requirements)
**Tests:** 142 → 314 (+172)

### What Shipped
- Phase 6: Feedback Attribution (CRITICAL — trace feedback to agent actions + pre-tool guard)
- Phase 7: Data Quality (validate-feedback, richContext, inferOutcome)
- Phase 8: Loop Closure (feedback-to-rules, plan-gate, inbox reader, memory bridge)
- Phase 9: Intelligence (context engine, skill quality tracker)
- Phase 10: Training Export (PyTorch, CSV, action analysis, DPO gate)
- Phase 11: Subway Upgrades (LanceDB, DPO, Thompson JS, self-healing)
- Phase 12: Proof Gate (all phases verified, 314 tests)

### Key Decisions
- CRITICAL gaps first — attribution before everything else
- Zero new npm deps for Subway governance ports
- Skills best practices: negative triggers added to SKILL.md

## v1.0 — Bidirectional Feature Sync (Complete)

**Shipped:** 2026-03-04
**Phases:** 1-5 (19 plans, 24 requirements)
**Tests:** 54 → 119 (+65)

### What Shipped
- Phase 1: Contract alignment (export audit, rubricEvaluation gate, parseTimestamp)
- Phase 2: ML into ThumbGate (Thompson Sampling, time-decay, LSTM sequences, diversity tracking)
- Phase 3: Governance into Subway (budget guard, intent router, ContextFS, self-healing)
- Phase 4: LanceDB vector storage (embedded vectors, ESM/CJS, semantic search)
- Phase 5: RLAIF + DPO (self-audit, DPO optimizer, meta-policy extraction)

### Key Decisions
- Cherry-pick features, not full merge — library/prototype boundary preserved
- Zero external API calls — all ML local ($0 budget spent)
- Dynamic import() for ESM-only LanceDB in CJS project
