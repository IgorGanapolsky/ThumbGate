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

## Reusable six-block context

`construct_context_pack` accepts a durable `contextEnvelope` that makes
few-shot examples and rubric-first evaluation reusable across agents:

```json
{
  "query": "Is this pull request ready?",
  "maxChars": 6000,
  "contextEnvelope": {
    "goal": "Decide whether the exact pull request head is merge-ready.",
    "businessData": ["Required checks and review threads are provider evidence."],
    "examples": ["Good: cite the exact SHA and terminal check run."],
    "procedures": ["Retrieve, compare with the rubric, then recommend."],
    "constraints": ["Never approve or bypass branch protection."],
    "rubric": ["Every readiness claim includes exact provider evidence."]
  }
}
```

The envelope is validated, counted against the same character budget as
retrieved memory, and included in semantic-cache identity. A changed example or
rubric cannot reuse a pack built for different instructions.

Retrieved items include safe provenance fields:

- `source` and optional `sourceUrl`;
- `observedAt` and optional `maxAgeSeconds`;
- `freshness`: `fresh`, `stale`, `future`, `invalid`, or `unknown`.

This is the connector boundary: live business data is useful only when the
source and freshness are carried with it. ContextFS does not turn an old
connector result into current truth.

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
