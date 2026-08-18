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

**Not installable yet.** `thumbgate init` dispatches on `--agent`, and `openmono` is not
a supported agent or auto-hook target, so `npx thumbgate init --adapter=openmono` would
exit 0 **without creating any hook configuration** — a success message for work that did
not happen. This file previously documented that command; it was wrong and is removed
rather than left to mislead.

What exists today is the contract in `openmono.json`: the hook surface, sub-agent budgets,
loop-detection mode and gate list that the runtime binding will implement.

Wiring lands together with:

1. upstream confirmation of the PreToolUse hook surface
   ([StartupHakk/OpenMonoAgent.ai#129](https://github.com/StartupHakk/OpenMonoAgent.ai/issues/129)),
2. `openmono` added to the `init` agent dispatch table, and
3. the adapter files added to `package.json` `files`, with the bundle ratchet bumped once,
   deliberately.

Until all three are true, treat this directory as a design contract, not an install path.

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
