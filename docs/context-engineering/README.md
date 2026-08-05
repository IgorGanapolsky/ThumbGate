# Context Engineering for ThumbGate Coding Agents

Maps [Hugging Face The Context Course](https://huggingface.co/learn/context-course/unit0/introduction) onto ThumbGate + Grok/Claude fleet practice.

**Thesis:** An agent is only as good as the context it can find *and* the hooks that constrain its tools. Skills structure knowledge; MCP exposes tools; plugins/workflows package loops; sub-agents parallelize; hooks enforce.

## Course → ThumbGate map

| HF Unit | Topic | ThumbGate / fleet surface |
|---------|--------|---------------------------|
| 1 | Agent Skills | `~/.grok/skills/*`, `skills/*`, Agent Skills Spec |
| 2 | MCP | `adapters/mcp/`, profiles in `config/mcp-allowlists.json` |
| 3 | Plugins / workflows | `.grok/workflows/*.rhai`, `.claude-plugin/` |
| 4 | Sub-agents | Grok `parallel()`, vault + Linear ownership |
| 5 | Hooks | PreToolUse: gate-check, spend-guard, outbound-email-guard |
| 6 | Nano harness | `gate-check` stdin contract, `bin/cli.js` |

## GSD stages (Get Shit Done)

Used for every multi-file context/coding task:

| Stage | Output |
|-------|--------|
| **Capture** | Failures, overclaims, missing match surfaces |
| **Clarify** | Skill vs MCP vs hook vs subagent (one owner layer) |
| **Organize** | Paths, claims, PR scope |
| **Execute** | Implement + tests |
| **Review** | Live probes + adversarial verify (no “looks fine”) |

## Ralph Loop (observe → act → feedback → promote)

| Ralph stage | ThumbGate wiring |
|-------------|------------------|
| Observe | SessionStart, vault preflight, gate-stats |
| Act | Tool calls under PreToolUse walls |
| Feedback | `capture_feedback` / thumbs / incident notes |
| Promote | `auto-promote-gates` / force-gate with **matchable** surfaces |
| Enforce | `gate-check` + deterministic guards |

**Rule:** promotion without a matchable tool surface is theater (AGENT-259).

## Checklist skill

Slash / auto-invoke: `context-engineering-checklist`  
Orchestrator: `gsd-ralph-context-loop`  
Workflow: `/context-engineering-pr-check`

## Non-goals

- Replacing ThumbGate with tutorial harnesses
- Putting irreversible policy only in prose skills
- Growing the npm package for ops dogfood scripts (keep `prove:vlt` local)
