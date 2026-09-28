# HALO Trace Optimizer (FORMAT Steal)

> Source: `https://inference.net/products/halo/`

## Context

HALO is an offline, OpenTelemetry-based agent trace analyzer built by Inference.net. It analyzes traces, identifies failure modes (e.g. latency stalls, redundant tool calls), and generates reports for Claude or Codex to write fixes.

ThumbGate steals the **Trace-to-Fix FORMAT** directly into our local runtime:
- **Trace Ingestion:** Analyzes local `~/.thumbgate/audit-trail.jsonl` and `.thumbgate/action-log.jsonl`.
- **4 Anomaly Detectors:**
  1. `redundant_tool_calls`: 3+ repeated calls to the same tool with identical input in a single session.
  2. `retry_stall`: Immediate duplicate retry of a failed/denied tool call without modification.
  3. `expensive_span`: Tool calls exceeding 10s latency or dumping >500 lines of output (token-shunt risk).
  4. `unhandled_denies`: Repeated triggers of the same gate ID.
- **Ranked Failure Modes:** Ranks patterns by frequency and severity blast radius.
- **Concrete Fix Synthesis:** Generates active auto-promoted gates with actionable remediation messages and test fixtures.
- **Fail-Closed Anti-Clone Boundary:** Refuses `--clone-halo` or external cloud telemetry dependencies.

## Usage

```bash
# Analyze local traces
npx thumbgate halo-trace-optimizer

# Output structured JSON
npx thumbgate halo-trace-optimizer --json

# Architecture mapping
npx thumbgate halo-trace-optimizer --map-only

# Automatically apply synthesized gate fixes
npx thumbgate halo-trace-optimizer --apply --json
```
