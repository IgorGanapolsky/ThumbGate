# Paper Instruments Ultramarine 1 Flash — FORMAT steal

> Stealable patterns from Paper Instruments' Ultramarine 1 Flash announcement and
> supporting documentation. These are **FORMAT-level pattern steals**, not product
> clones. ThumbGate does not vendor Ultramarine weights, Paper Office packages,
> or the Feather harness — we adopt the architectural patterns onto existing
> ThumbGate rails.

## Sources

- Product page + blog: https://www.paperinstruments.com/ultramarine
- Model card: https://huggingface.co/paperinstruments/Ultramarine-1-Flash
- Docs: https://docs.paperinstruments.com/docs/ultramarine
- Technical report: https://www.paperinstruments.com/blog/ultramarine

## Stealable Patterns

### 1. Prompt Tuning Format — "Fork Your Prompts"

**Pattern**: Prompts tuned for other models must be forked and retuned per
target model. The tuning format includes three directives that are applied
*while drafting* (not as a cleanup pass):

1. **Concision with completeness** — "The balance that matters most in prose is
   concision with completeness." Never cut at the cost of completeness.
2. **Stopping rule** — "Finish when the requested result is usable and the
   observable requirements are satisfied. Once you judge the work complete, the
   next action is the handoff. **YOU MUST NOT KEEP WORKING ON FINISHED WORK.**"
3. **No self-evaluation** — "Never evaluate yourself. Do not produce summaries
   of what you did, apologies, or meta-commentary."

**Steal onto**: `AGENTS.md` / `CLAUDE.md` / individual skill descriptions.
Applied as drafting-time directives, not post-hoc cleanup.

### 2. Paper Office Package Pattern — "Typed-error, leave file unchanged"

**Pattern**: `paper-docx`, `paper-pptx`, `paper-xlsx` fork upstream libraries
(`python-docx`, `python-pptx`, `openpyxl`), keep the familiar import names, and
on unsupported or unsafe edits they **raise a typed error and leave the file
unchanged** rather than silently corrupting it.

**Steal onto**: `scripts/hook-pre-tool-use.js` `summarizeActionRiskContext()`
write-snippet check and the protected-file path gating in
`scripts/gates-engine.js`. When an edit to a protected file is rejected, return
a typed error message naming the protection rule rather than attempting a
partial/suppressed modification.

### 3. Content Fingerprint Stale-Check

**Pattern**: Feather records a content fingerprint (SHA-256 hash of complete
file contents) on each read and checks it before editing or overwriting. If
the contents have changed since the read, the modification is rejected and the
agent is asked to re-read the file.

**Steal onto**: `scripts/gates-engine.js` — add a `recordFileFingerprint` /
`checkFileFingerprint` pair around file-edit and file-write tool calls. The
agent harness (`bin/cli.js` or the Hook dispatcher) should track the
fingerprint from the most recent `read` of a file and reject `edit`/`write`
calls when the on-disk content no longer matches.

### 4. Minimal System Prompt for Training / Fast Loop

**Pattern**: Feather's training system prompt is three sentences, ~50 tokens:

> You are an agent working in a Linux sandbox with access to the provided tools
> and workspace.
> Do not expose, log, transmit, or write secrets or credentials.
> When relevant, put requested file deliverables at the paths specified by the
> user or environment.

**Steal onto**: The `local_free` tier in `scripts/model-tier-router.js` when
routing to Laguna XS 2.1. The fast model gets a leaner prompt; the capable_code
tier retains the full ThumbGate guardrails.

### 5. Tool Descriptions: State What It Does, Not When to Use It

**Pattern**: Feather's tool descriptions "state what a tool does and what it
guarantees, rather than when or how to use it." No prescriptive instructions.

**Steal onto**: `scripts/codex-docgen.js` or skill manifests. When generating
tool descriptions for MCP tools or skill manifests, prefer description of
behavior over usage guidance.

### 6. Image-Read Response — "Vision is not available"

**Pattern**: To avoid repeated image-read attempts, `read` returns a text
observation for supported image extensions:

```
read({"file_path": "chart.png"})
→ Vision is not available in this environment.
```

**Steal onto**: File-read paths in the agent harness (`scripts/hook-pre-tool-use.js`
or the filesystem-read adapter). When `read` is called on an image file
(`.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`), return the standard text
message instead of raw bytes.

### 7. Context Compaction Dual-Trigger

**Pattern**: Compaction triggers at **85% of the context window or when
30,000 tokens remain, whichever occurs first**. This replaces single-threshold
rules (e.g., "compact at 75%").

**Steal onto**: `scripts/token-shunt-honesty.js` and the CLAUDE.md
`PostCompact` hook configuration. The dual trigger — a percentage threshold
*plus* an absolute token floor — prevents premature compaction on long-context
windows and prevents late compaction on short ones.

### 8. Max Agent Turns

**Pattern**: Training config sets `max_agent_turns = 250` as a hard cap on
trajectory length.

**Steal onto**: `bin/agent-loop.js` — expose a configurable `--max-turns` flag
(defaulting to 250) that the orchestration layer enforces.

### 9. Token Reservation Before Generation

**Pattern**: Before generation, the server reserves estimated message input
plus output budget: "We reserve estimated message input plus your output budget.
Set `max_completion_tokens` to your task's output budget."

**Steal onto**: `scripts/budget-guard.js` / `src/api/server.js` — pre-reserve
an estimated input token count plus a user-supplied output budget before
dispatching to the model provider. If the reservation would exceed the tier
budget, fail closed.

### 10. Rate-Limit Headers

**Pattern**: API responses include rate-limit headers:

```
x-ratelimit-limit-requests
x-ratelimit-remaining-requests
x-ratelimit-reset-requests
x-ratelimit-limit-tokens
x-ratelimit-remaining-tokens
```

**Steal onto**: `src/api/server.js` — emit these headers on every API response,
sourced from `scripts/rate-limiter.js` state, so agents and callers can
self-throttle.

### 11. API Key Environment Prefixes

**Pattern**: `pi_live_` for production keys, `pi_test_` for non-production.
"The live key goes into your production environment; the test key goes into your
staging environment."

**Steal onto**: `src/api/server.js` + `config/gates/auth.json` — adopt
`tg_live_` / `tg_test_` prefixes for ThumbGate API keys. Validate the prefix
against the deployment environment at request time.

### 12. Sandboxed Orchestration

**Pattern**: The agent loop runs on the orchestrator; commands and file
operations execute inside the sandbox. Model inference credentials and
agent-loop code remain outside the environment the model can modify, so
nothing the model does in the sandbox can alter its own harness, credentials,
or grader.

**Steal onto**: Existing ThumbGate design is already aligned —
`scripts/hook-pre-tool-use.js` runs outside the agent's shell context. Document
the isolation boundary in `docs/architecture/harness-isolation.md` and ensure
the `gates-engine.js` PreToolUse check cannot be modified from within a
sandboxed agent session.
