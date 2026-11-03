# OpenUI Lang Steal: Compact Streaming Format (39.6% Token Reduction)

## Steal Source
[thesysdev/openui](https://github.com/thesysdev/openui) — 13,672 stars, MIT

## Problem
Verification reports are verbose JSON blobs. Each check result includes redundant key names (`"id":`, `"status":`, `"duration":`). On large CI/CD runs, this wastes thousands of tokens per report.

## Pattern Stolen

### 1. Compact Line-Based Format
OpenUI Lang replaces nested JSON objects with pipe-delimited lines:
```
tl|report
v|1.0
s|PASS
c|unit_tests|PASS|254ms
```
vs JSON:
```json
{"format":"json","version":"1.0","verdict":"PASS","checks":[{"id":"unit_tests","status":"PASS","duration":254}]}
```

### 2. Streaming Output
Instead of building the full report and outputting at once, emit results as checks complete. The consumer (CI/CD, dashboard) can display progress in real-time.

### 3. Component Registry → Check Registry
OpenUI's component library defines what the model can output (deny-by-default). We apply this to verification: `config/verifier-criteria.json` is a typed check registry. Only registered checks can run.

## How ThumbGate Applies It

`scripts/streaming-reporter.js`:
- `StreamingReporter` class — emits compact line-based reports
- `onCheckComplete()` — streams results as checks finish
- `render()` — produces final compact report
- `parse()` — round-trip parsing
- `benchmarkReportSize()` — measures JSON vs compact format

**Benchmark result**: 871 bytes (JSON) → 526 bytes (compact) = **39.6% savings**

The 67% claim from OpenUI is on their specific UI scenarios; our 39.6% includes budget metrics and latency profiles inline. Savings compound on larger reports (more checks = more repeated key names eliminated).

## Pro Value
Pro adds:
- 127 additional check schemas with typed contracts
- Cross-check dependency tracking in compact format
- Real-time observability event bus streaming
- Report compression for multi-repo verification (aggregate many reports into one compact stream)

**Steal command**: `npx thumbgate init` → select "compact-reports-pack"
