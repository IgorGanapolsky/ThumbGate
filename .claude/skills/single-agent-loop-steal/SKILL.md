---
name: single-agent-loop-steal
description: "Steal Anthropic Oct 2026 patterns: write gates, token budgets, progressive skill disclosure, batch nudges, chained-dependent-ops, and the optional verifier that rejects twice."
tags: [format-steal, agent-architecture, write-gate, token-budget, progressive-disclosure, verifier]
domain: agent-harness
source: https://github.com/anthropics/single-agent-loop-kit
---

# Single-Agent Loop — Architectural Steal from Anthropic

> Source: [ananthropics/single-agent-loop-kit](https://github.com/anthropics/single-agent-loop-kit)
> Reference implementation, not maintained, not accepting contributions.

## Key Patterns to Steal

### 1. Write Gate (Mandatory Safety)

The reference loop **raises ValueError in the constructor** if any tool has `writes: true`
and no `approve` callback is provided. A missing gate must NOT mean every write runs.

```python
# Reference loop — fails closed
if unguarded and approve is None:
    raise ValueError(f"These tools write: {', '.join(unguarded)}. Pass approve=...")
```

**Steal for ThumbGate:** The Isolated Verifier's `runCommand` should require an
`approveWrites` callback for any command that could modify the filesystem. Commands that
are read-only (git diff, git diff --numstat, file reads) run without approval; commands
that execute tests or build steps go through the gate.

### 2. Token Budget with Subagent Accounting

```python
def charge(self, usage):
    """Count tokens spent outside this loop's own model calls against the same budget.
    A tool that runs a subagent calls this with the usage of each subagent response."""
```

**Steal for ThumbGate:** The verifier should track a budget of max commands + max wall-clock
time. `runMechanicalChecks` should enforce the budget and stop early if exceeded.

### 3. Progressive Skill Disclosure

```python
# Only a one-line description sits in the system prompt;
# the model loads the full text via load_skill before doing work it covers.
listing = "\n".join(f"- {name}: {skill['description']}" for name, skill in self.skills.items())
self.system += f"\n\n## Skills\n\nLoad a skill with load_skill before doing work it covers.\n\n{listing}"
```

**Steal for ThumbGate:** SKILL.md files should have YAML front-matter
(`name:`, `description:`) so a skill loader can list all skills compactly and load full
instructions on demand via a `load_skill` tool.

### 4. Read/Write Separation in Tool Execution

```python
def _run_batch(self, calls):
    """Reads run in parallel. Writes run one at a time, after the reads."""
    reads = [c for c in calls[:limit] if not self.tools.get(c.name).writes]
    # ... run reads in parallel via ThreadPoolExecutor ...
    # ... then run writes sequentially after reads ...
```

**Steal for ThumbGate:** In the Isolated Verifier, read-only git commands
(`git diff --name-only`, `git diff --numstat`, `git diff HEAD`) should run in parallel;
write-prone commands (test runners, build steps) should run after reads and after
write-gate approval.

### 5. Optional Verifier with "Reject Twice" Policy

```python
complaint = self.verify(text, messages) if self.verify else None
if not complaint:
    return Result(text, "answered", ...)
complaints += 1
if complaints > 1:  # one chance to fix it
    return Result("", "verify_failed", ...)
```

**Steal for ThumbGate:** The PR manager should invoke the Isolated Verifier as an optional
verifier. If the verifier rejects twice (two consecutive FAILs), the PR submission is
blocked — no agent can retry past the verifier indefinitely.

### 6. Max Batch Cap

```python
max_batch: int = 16  # tool calls per turn; excess gets an error result
```

**Steal for ThumbGate:** The verifier should cap the number of mechanical checks it runs
per invocation, returning error results for checks that exceed the budget.

## What NOT to Clone

- Do NOT clone the Anthropic `anthropic` Python package or the `anthropic` SDK.
- Do NOT clone the reference_loop/loop.py as a framework — it is a reference to read, not a dependency to ship.
- Do NOT clone the "merge subagents" workflow directly — ThumbGate's domain is pre-action
  enforcement, not agent orchestration.

## Application to ThumbGate

1. **Add `approveWrites` callback** to `runCommand` in `scripts/isolated-verifier.js` ✅
   - `--approve-writes` CLI flag added to `parseArgs`
   - `runVerification` threads `approveWrites` → `runMechanicalChecks` → `runCommand`
   - Write-prone commands (`writes: true` in criteria) denied fail-closed without approval
   - `verify:isolated` npm script passes `--approve-writes` for automated runs
   - 5 new tests covering write gate behavior (deny without callback, deny on false, allow on true, allow non-write without callback, fail-closed in runVerification)
2. **Add `maxCommands` budget** to the verifier config ✅
   - `criteria.budget` with `maxCommands` (default 10) and `maxWallTimeMs` (default 600000)
   - Budget check in `runMechanicalChecks` skips remaining checks when exceeded
   - `commandsRun` counter + `wallStart` timer enforced per check loop
3. **Standardize SKILL.md front-matter** across all `.claude/skills/*/SKILL.md` ✅
4. **Add `load_skill` tool** to the agent harness for progressive disclosure
5. **Add verifier reject-twice** gate to `scripts/pr-manager.js`

## Operational Enforcement — Batch Nudge + Chained Dependencies

Anthropic's October 2026 guidance for Claude Fable 5.1 recommends a per-turn nudge
to keep parallelism working in long agent loops:

> "First privately list what you need next; then request every item that doesn't
> depend on another's result in this one response."

This is implemented as a **turn-scoped system instruction** appended after each tool
result batch. In a harness without mid-conversation system messages, the equivalent
is a disciplined internal checkpoint: *before ending a tool-dispatch turn, enumerate
the next independent operations and fire them in the same response block.*

The failure mode to avoid is **cascading cancellation** (GH-64333): if one tool in a
parallel batch errored, Anthropic cancels all sibling calls in that turn. The fix
is to **chain dependent operations into a single `shell` invocation** (`&&` / `;`
instead of separate calls) and to **batch only truly independent I/O**.
