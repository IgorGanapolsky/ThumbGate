---
name: anthropic-judgment-calls-steal
description: >
  Steal Anthropic's "Agents and judgment calls" FORMAT patterns (agent lean
  disclosure, deferral detection, argument source crediting, decision
  attribution tracking, explicit judgment points, confidence calibration)
  onto ThumbGate's multi-agent coordination rails. Slash:
  /anthropic-judgment-calls-steal.
---

# Anthropic judgment-calls FORMAT steal

## Goal

Prevent the 86% deferral problem Anthropic documented: agents influence human
judgment without the human realizing it. Adopt disclosure, attribution, and
deferral-detection patterns onto ThumbGate's Herdr swarm coordination so that
multi-agent decisions remain independently attributable.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Vendor Anthropic's study data or judge model | Implement disclosure + attribution in local TS/JS |
| Clone Claude Code's harness | Use existing ThumbGate PreToolUse + Herdr lease rails |
| Suppress agent preference disclosure | Surface lean + source_agent on every shared fact |

## Stolen Patterns (Implemented)

### 1. Agent Lean Disclosure

In `.herd-swarm/sow-latest.json`, the `shared_facts` capsule now requires a
`source_agent` field for every entry. Downstream agents must cite the source.

### 2. Deferral Detection

Added to `scripts/gates-engine.js`: `deferralRisk` field in gate action
fingerprint. When an agent's output echoes a prior agent's phrasing without
independent verification, flag it.

### 3. Decision Attribution Tracking

`.herd-swarm/decisions.md` now records a `decision_attribution` ledger:
which decisions were independently made vs. influenced by upstream agents.

### 4. Explicit Judgment Points

Each SOW slice's `role` specifies which decisions are in-scope and which are
explicitly deferred to the judge seat (`judge@clinic`).

### 5. Confidence Calibration Feedback

Added to `tests/a-plus-evidence-scorecard.test.js`: `confidence_calibration`
check that cross-references stated confidence against actual correctness.

## Reference

- https://www.anthropic.com/research/agents-judgment-calls
