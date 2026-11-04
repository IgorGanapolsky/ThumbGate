---
name: aaif-crowdstrike-fiddler-dreadnode-honesty
description: Operationalizes Mazin Gilbert's Linux Foundation AAIF 6-standard interoperability (MCP, AGENTS.md, goose, Agent Skills, Open Responses, OpenEnv + In-Flight Engine Swap) and CrowdStrike's $495M AI security acquisitions (Fiddler AI $400M Falcon Observe Flight Recorder + Dreadnode $95M Offensive Red-Team Gauntlet + Falcon Guardian PreToolUse Kill Switch).
---

# AAIF 6-Standard Interop & CrowdStrike / Fiddler / Dreadnode ($495M) Honesty Gate

## Core Mandate

1. **AAIF 6-Standard Vendor-Neutral Conformance (`auditAaifSixPillarInterop`)**:
   - Maintain native interoperability across all 6 Linux Foundation Agentic AI Foundation (AAIF) specifications: `MCP`, `AGENTS.md`, `goose` YAML recipes, `SKILL.md` Agent Skills, `Open Responses API`, and `OpenEnv`.
   - Enforce Mazin Gilbert's **In-Flight Engine Swap** invariant (`validateInFlightEngineSwap`): hot-swapping models mid-session (e.g. `opus-5.5` $\rightarrow$ `gemini-4-carbon`) must never drop the active checkout lease or `AGENTS.md` policy hash.
2. **Dreadnode ($95M) Pre-Deployment Offensive Gauntlet (`runDreadnodeOffensiveGauntlet`)**:
   - Run automated multi-turn privilege escalation, indirect prompt injection, byte-obfuscated shell evasion, and `--admin` branch-protection bypass payloads against ThumbGate's `<1ms` PreToolUse diode before every release.
3. **Fiddler AI ($400M Falcon Observe) Flight Recorder + Falcon Guardian PreToolUse Kill Switch (`evaluateFalconObserveAndKillSwitch`)**:
   - Emit SHA-256 flight-recorder receipts for every agent turn AND trip a deterministic `<1ms` PreToolUse Kill Switch (`KILL_SWITCH_TRIPPED_PRE_EXECUTION`) before destructive tool execution, behavioral drift spikes (`driftScore > 0.75`), or token budget overruns.

## Verification

```bash
node scripts/aaif-crowdstrike-fiddler-dreadnode-honesty.js --json
node --test tests/aaif-crowdstrike-fiddler-dreadnode-honesty.test.js
```
