# Jcode Gateway Adapter

## Overview

This adapter bridges ThumbGate's Infrastructure Firewall with jcode's deterministic risk assessment system.

## High-ROI Features

### 1. Command Risk Classification Bridge

jcode's `jcode-command-risk` provides stage-1 deterministic assessment:
- **Stage 1**: Pure blast-radius assessment (no network, no model)
- **Stage 2**: Reflection/justification when needed

#### Key Insight
jcode's `justification` field mirrors ThumbGate's `feedback` capture mechanism.

### 2. Gated Thermal Throttling

**Problem**: AI agents are expensive.
**Solution**: jcode shows RAM efficiency (27MB vs 386MB for Claude Code).

Implement adaptive tooling:
- Monitor resource usage
- Throttle high-cost tools when constrained
- Prioritize low-RAM, high-value operations

### 3. Multi-Provider Gate Union

Unified protection across runtimes:
- Claude Code (via PreToolUse hook)
- Cursor (via extension)
- Codex (via native gated commands)
- Gemini CLI (via MCP guard)
- jcode (via built-in gate)

## Implementation

### Risk Assessment Interface

```typescript
interface RiskContext {
  working_dir: string;
  shell: string;  // bash, cmd.exe, zsh, etc.
  is_windows: boolean;
}

interface RiskFinding {
  level: 'Safe' | 'Low' | 'Confirm' | 'Catastrophic';
  reason: string;        // Explanation for model
  target?: string;     // Path/argument that triggered
}
```

### Thermal Throttling Logic

```typescript
function shouldThrottle(tool: string, cost: number, resources: ResourceUsage): boolean {
  // If system memory pressure > 80%, throttle expensive tools
  // If session active time > 30min, encourage break
  // If model rate limit near, queue requests
  return false;  // Placeholder
}
```

## Verification Evidence

- jcode RAM comparison: 27.8MB (baseline) vs 386.6MB (Claude Code) = 6% resource cost
- jcode boot time: 14.0ms vs 1518.6ms (GitHub Copilot) = 1% latency cost

## References

- jcode: https://jcode.sh
- jcode-command-risk: Deterministic risk classification
- Issue #604: User lost home directory due to ungated `rm -rf`