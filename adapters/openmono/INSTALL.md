# ThumbGate × OpenMono

[OpenMono](https://github.com/StartupHakk/OpenMonoAgent.ai) is a terminal-native coding
agent that runs local LLMs — .NET 10 CLI, bundled llama.cpp, 20 tools, 5 specialist
sub-agents, Docker sandbox.

## What OpenMono already does

Worth stating plainly, because this adapter is not a "you have no guardrails" pitch:

- **Docker sandbox** — the workspace mount is an explicit blast radius
- **A real chokepoint** — "nothing bypasses the pipeline", which is the hard part
- **Doom-loop detection** — aborts when the same tool sequence repeats 3×
- **Per-sub-agent turn budgets** — Explore 15, Plan 10, Coder 30, Verify 20
- **Write restriction** — read-only tools parallelized, writes limited to authorized agents

## What this adapter adds

Every control above is **static and per-run**. The sandbox boundary, the turn budgets and
the loop threshold are identical on run 1 and run 500. If an agent does something
destructive on Monday, nothing about Tuesday's run is different unless a human notices and
hand-edits config.

ThumbGate closes that loop:

```
tool call → gate-check (PreToolUse) → allow / warn / block
                  ↑                          ↓
          prevention rules  ←  lesson  ←  captured failure
```

Two integrations specific to OpenMono's design:

1. **Adaptive doom-loop detection.** Upstream aborts at a fixed 3× repeat. With
   `loopDetection.adaptive`, ThumbGate records *which* sequences preceded wasted runs in
   this repo and denies those earlier — while leaving legitimate retry loops alone.
2. **Evidence-based turn budgets.** `Explore=15` is a guess that must hold for every repo.
   Observed per-repo completion distributions turn it into a measured number.

## Install

```bash
npm install -g thumbgate
npx thumbgate init --adapter=openmono
```

This registers the PreToolUse hook from `openmono.json` against OpenMono's existing
permissions pipeline. No change to the 12-step execution flow is required.

Verify the wiring:

```bash
npx thumbgate doctor
```

## Enforcement posture

`failClosed` is `false` by default: if the gate runtime is unavailable, OpenMono's own
pipeline still governs the call and work continues. Set it to `true` in regulated
environments where an unavailable gate must stop the agent instead.

Only these categories hard-block by default — everything else warns:

| Category | Default |
|---|---|
| `secret-exfil` | block |
| `destructive-shell` | warn |
| `branch-protection` | warn |
| `spend-commerce` | warn |
| `production-deploy` | warn |

Raise the rest with `THUMBGATE_STRICT_ENFORCEMENT=1`.

## Licensing

ThumbGate is permissive; OpenMono is AGPL-3.0. This adapter lives in the ThumbGate repo
and talks to OpenMono over its existing interface, so it imposes no copyleft obligation on
either side and asks for no relicensing.

## Status

Proposed upstream in
[StartupHakk/OpenMonoAgent.ai#129](https://github.com/StartupHakk/OpenMonoAgent.ai/issues/129).
The config here is the ThumbGate-side contract; the runtime binding lands once upstream
confirms the hook surface.
