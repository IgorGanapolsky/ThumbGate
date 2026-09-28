---
name: gsd-ralph-context-loop
description: >
  Orchestrate coding work with GSD (Capture→Clarify→Organize→Execute→Review) and
  Ralph Loop (Observe→Act→Feedback→Promote→Enforce). Use parallel agents/workflows
  for multi-faceted tasks. Auto-invoke when user says GSD, Ralph Loop, get shit done,
  work in parallel agents, context course, or all of it for context engineering.
  Slash: /gsd-ralph-context-loop.
---

# GSD + Ralph Loop for ThumbGate coding

## GSD (Get Shit Done)

| Stage | Agent does | Artifact |
|-------|------------|----------|
| **Capture** | List failures / goals / evidence gaps | Notes or issue bullets |
| **Clarify** | Skill vs MCP vs hook vs subagent | Layer decision |
| **Organize** | Files, PR branch, Linear claim, vault | Ledger |
| **Execute** | Implement + tests (parallel when independent) | Diff + green tests |
| **Review** | Probes, adversarial verify, three-bus ship | TRUE/FALSE ledger |

Never jump to Execute without Clarify (wrong layer = inert gates / thrash).

## Ralph Loop (always-on improvement)

| Stage | Surface |
|-------|---------|
| **Observe** | Session preflight, gate-stats, CI, vault |
| **Act** | Tools under PreToolUse walls |
| **Feedback** | Thumbs / incident / capture_feedback |
| **Promote** | Matchable force-gate / auto-promote |
| **Enforce** | gate-check + deterministic guards |

Ralph without Promote→Enforce is analytics only.  
Promote without matchable surface is AGENT-259 theater.

## Parallel agents (when)

| Use parallel / workflow | Stay serial |
|-------------------------|-------------|
| PR multi-lane review | One-line fix |
| Enforcement audit | Single file |
| Skills + docs + tests independent | Shared-file conflict |
| Linear top-10 triage | Already claimed by sibling |

Default workflows:

- `/pr-adversarial-review`
- `/thumbgate-enforcement-audit`
- `/context-engineering-pr-check`
- `/linear-top10-triage`

## Session execute recipe

```bash
# Observe
bash ~/.grok/skills/multi-agent-coord/scripts/session_preflight.sh
bash ~/.grok/skills/three-bus-ship-cycle/scripts/ship_cycle_status.sh

# GSD Capture/Clarify via checklist skill
# Execute with worktree branch
# Review
bash ~/.grok/skills/three-bus-ship-cycle/scripts/ship_cycle_check.sh <PR> <AGENT-ID>
```

## Completion gate

Before done/shipped/fixed:

1. Review probes green  
2. Three-bus updated  
3. No prose-only gates  
4. No stolen Linear locks  

## Related

- [[context-engineering-checklist]]
- [[three-bus-ship-cycle]]
- [[xai-workflows-for-system]]
- [[multi-agent-coord]]
