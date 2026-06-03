# Perplexity Hybrid Local-Cloud Inference Adapter for ThumbGate

Perplexity's hybrid local-server inference orchestrator (announced at Computex 2026, part of Personal Computer) intelligently routes AI workloads: sensitive or routine work stays on-device (local models on AI PCs like Intel Core Ultra or NVIDIA RTX), while high-capability work escalates to frontier cloud models — all autonomously, mid-task, based on privacy, cost, latency, and accuracy.

This is a **high-ROI integration point** for ThumbGate because:

- ThumbGate is local-first governance for agentic systems.
- Hybrid agents (Personal Computer style: always-on, file/app access, multi-step workflows) are exactly what we govern.
- Enables private, cost-effective agent loops without sacrificing intelligence.
- Amplifies need for our capture/lessons/prevention rules (hybrid routing creates new decision points and failure modes to learn from).

## Benefits for ThumbGate Users & Workflows

- **Privacy**: Keep code context, feedback ("what went wrong"), lessons, and sensitive files on-device. Local models decide sensitivity before any cloud send. ThumbGate gates can enforce "no cloud escalation for paths matching secrets/PII".
- **Cost**: Agentic coding loops and always-on agents are expensive on pure cloud. Hybrid can cut inference costs significantly (reports of ~50% in some analyses) by using local for pre-tool gates, triage, simple reasoning.
- **Latency**: Real-time preToolUse hooks and MCP calls benefit from fast local models for quick checks; only complex planning goes cloud.
- **Reliability**: Weaker local models + routing decisions = more mistakes to capture. ThumbGate turns those into prevention rules ("when local model under-classifies sensitivity on customer data, force explicit approval").
- **Sovereignty & Compliance**: Data stays in jurisdiction/device. Perfect for enterprise/federal use cases where ThumbGate shines.

See the Perplexity announcement for details: https://www.perplexity.ai/hub/blog/the-data-center-moves-to-your-machine and VentureBeat coverage.

## Current Support

ThumbGate already supports running alongside Perplexity via side-by-side MCP (see config.toml, opencode.json in this dir for Codex/OpenCode/Claude).

This HYBRID extension adds:

- Model candidate entries in `config/model-candidates.json` for Thompson sampling / lane selection (perplexity/hybrid-local-cloud for full power, perplexity/hybrid-local for cheap/fast/privacy paths).
- Guidance for governing hybrid routing decisions.
- Example prevention rules and capture patterns for hybrid agent actions.
- Integration notes for Personal Computer agents.

## Setup for Hybrid Agents

1. **Use Perplexity Personal Computer / hybrid as an agent runtime** alongside ThumbGate hooks/MCP.

2. **MCP Configs** (update your editor/agent config to include Perplexity's hybrid-enabled server when available; currently side-by-side works):

   See `config.toml` and `opencode.json` — they already wire ThumbGate + Perplexity MCP. For hybrid, add env or flags for local inference when Perplexity exposes (expected July 2026+).

3. **In ThumbGate**:
   - Add tags like `hybrid-route-local`, `hybrid-escalate-cloud`, `sensitive-context` when capturing feedback from hybrid agents.
   - Use `capture_feedback` with `chatHistory` or `conversationWindow` including routing metadata if the agent exposes it.
   - Define custom rules via `config/gates/` or templates for "block cloud send on secret files".

Example capture for hybrid decision:
```json
{
  "signal": "down",
  "context": "Perplexity hybrid agent escalated sensitive code review to cloud without approval",
  "whatWentWrong": "Local model correctly flagged sensitivity but orchestrator overrode to cloud for 'better context'",
  "whatToChange": "Add gate: require explicit user approval for cloud escalation on files containing 'secret' or customer PII",
  "tags": ["hybrid-escalate-cloud", "privacy-violation", "perplexity-personal-computer"],
  "skill": "perplexity-hybrid"
}
```

## High-ROI Use Cases

- **Gated Personal Computer agents**: Run always-on Perplexity PC for dev workflows (code search, refactoring, research). ThumbGate captures every action, learns rules specific to hybrid splits.
- **Cost-optimized agent fleets**: Use hybrid-local for routine pre-gates and triage; escalate only ambiguous/high-value to cloud. Track savings in your Thompson posteriors.
- **Privacy-preserving "chat with your data"**: For ThumbGate dashboard RAG over lessons (currently Gemini), route via Perplexity hybrid when available — keep sensitive feedback local.
- **New prevention rules**: Templates like "require-hybrid-local-for-pii", "audit-cloud-escalation-decisions".
- **Benchmarking**: Use the new model candidates in `npx thumbgate model-candidates` or `thumbgate eval` to compare hybrid vs pure cloud vs self-hosted on your workloads.

## Recommended Gates / Rules (add to your config/gates or use via CLI)

- Block or require approval for cloud routing on paths with `secret`, `env`, `.key`, customer data patterns.
- Capture "hybrid" as a dimension in feedback for Thompson sampling (prefer local lanes for sensitive).
- In MCP preToolUse: inspect if the tool call involves "send to cloud" or routing decision, gate it.

See `scripts/gates-engine.js` and `hybrid-feedback-context.js` for how to extend `evaluatePretool` with hybrid context.

## Extending the Adapter

- Add Perplexity-specific MCP tools for querying hybrid status or forcing local route.
- When Perplexity releases dedicated hybrid MCP server, wire it in configs like the existing one.
- Update `adapters/perplexity/` with more (e.g., function declarations if they add tool calling for hybrid decisions).
- Contribute back: PRs welcome for Personal Computer adapter.

## References

- Perplexity blog: https://www.perplexity.ai/hub/blog/the-data-center-moves-to-your-machine
- Personal Computer: https://www.perplexity.ai/personal-computer
- VentureBeat: https://venturebeat.com/technology/perplexity-ai-unveils-hybrid-local-cloud-inference-system-at-computex-2026
- ThumbGate Perplexity adapter (base): config.toml, opencode.json here.
- Model catalog: `config/model-candidates.json` (search for "perplexity/hybrid")
- Capture feedback: use `thumbgate capture` or MCP tool with hybrid tags.

This makes ThumbGate the governance layer for the emerging hybrid agentic era. Local power + cloud intelligence, governed end-to-end.

Run `npx thumbgate model-candidates --workload=pretool-gating --json` (after updating catalog) to see the new candidates in your routing decisions.

For questions or to contribute hybrid-specific lessons, use ThumbGate capture on your Perplexity hybrid agent sessions.