# Anthropic "Agents and judgment calls" — FORMAT steal

> Stealable patterns from Anthropic's October 2026 study "How AI agents shape
> experts' judgment calls" (Amaç Herdağdelen, Hailey Joren, Alex Tamkin).
> These are FORMAT-level pattern steals — not product clones. We adopt the
> *institutional design* patterns onto ThumbGate's multi-agent coordination
> rails.

## Source

- Paper: https://www.anthropic.com/research/agents-judgment-calls
- Published: Oct 27, 2026
- Study: 50 professional analysts using Claude Code on causal-inference tasks.
  Agents were given hidden "leans" on four analytical decisions. Analyst
  followed agent lean 86% of the time (expected 50% if lean had no effect).
  77% of analysts repeated the agent's arguments afterward, but only 15%
  credited the agent as the source.

## Stealable Patterns

### 1. Agent Lean Disclosure

**Pattern**: When an agent has an implicit or explicit preference that could
sway a decision, it must **disclose that preference** explicitly rather than
voicing it as neutral analysis. The study showed that analysts adopted
agent arguments as their own without crediting the source.

**Steal onto**: ThumbGate's multi-agent swarm (`sow-latest.json`) and
`scripts/hook-pre-tool-use.js`. When the `builder-core@workshop` agent's
recommendations are influenced by `scout@workshop`'s prior analysis, the
builder must prefix its proposal with an attribution: "Following analysis from
`scout@workshop` (Poolside Laguna XS), I recommend…"

### 2. Deferral Detection

**Pattern**: Detect when a human (or downstream agent) defers to an upstream
agent's recommendation rather than forming an independent judgment. The study
measured deferral rate (86%) but real-world systems lack detection.

**Steal onto**: `scripts/gates-engine.js` and the SOW claim/lease mechanism.
Add a `deferralRisk` field to the gate action fingerprint: when an agent's
tool calls or output text echo the prior agent's phrasing without independent
verification, flag it as a potential deferral. Surface this in the
`judge@clinic` rubric under a new "independence" criterion.

### 3. Argument Source Crediting

**Pattern**: 77% of analysts repeated the agent's argument but only 15%
credited the source. The fix: **require explicit attribution** when an agent
adopts another agent's argument or framing.

**Steal onto**: The Herdr swarm shared_facts capsule. When `scout@workshop`
populates `shared_facts`, each fact entry must include a `source_agent` field.
When a downstream agent references a fact, it must cite the source agent. The
`judge@clinic` rubric scores on whether attributions are present.

### 4. Decision Attribution Tracking

**Pattern**: Institutions treat an expert's sign-off as evidence of independent
judgment, but AI agents shape those decisions. Track *which* decisions were
influenced by agent input.

**Steal onto**: `.herd-swarm/decisions.md` and the task-state ledger. Every
decision point in the swarm workflow must record whether the deciding agent
independently arrived at the conclusion or was influenced by upstream
recommendations. This populates a `decision_attribution` ledger alongside the
existing `shared_facts` capsule.

### 5. Explicit Judgment Points

**Pattern**: Agents should raise only the decisions that matter most, and at
those points, present the strongest case for *each* option (not just the
agent's lean).

**Steal onto**: The SOW slice definitions in `.herd-swarm/sow-latest.json`.
Each slice's `role` field should specify which decisions are in-scope and
which are explicitly deferred to the judge seat. The `builder-core` and
`builder-ui` slices must surface judgment points as explicit tool calls to
the judge, not implicit assumptions.

### 6. Confidence Calibration Feedback

**Pattern**: Analysts who followed the agent's lean were as confident as those
who didn't (71 vs 73 on 0–100 scale), despite being equally influenced.
Confidence should be calibrated against actual accuracy.

**Steal onto**: `scripts/trajectory-scorer.js` and the LLM-as-Judge rubric.
Add a `confidence_calibration` check: when an agent states a confidence
score, the judge cross-references it against the actual correctness of the
deliverable. Misaligned confidence (high but wrong) is penalized.
