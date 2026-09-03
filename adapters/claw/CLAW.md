# Claw-Style Enterprise AI Agents + ThumbGate

Automation Anywhere's EnterpriseClaw (and the Nvidia OpenShell runtime it builds on) brings "claw-style" autonomous AI agents to the enterprise:

- Device-level / local or shared file system access.
- Dynamic tool creation at runtime (self-evolving agents).
- Direct screen/UI/computer interaction (like a human at the keyboard).
- Multi-platform orchestration across enterprise systems (on-prem, air-gapped, hybrid cloud).
- Backed by Cisco, Nvidia, Okta (agent identity), OpenAI (GPT 5.5).

The article explicitly notes: "Claw-style AI agents are coming to the enterprise. The governance infrastructure is still catching up."

**ThumbGate is that governance infrastructure.**

## Why High-ROI for ThumbGate

- Matches ThumbGate's mission perfectly: pre-action gates before risky operations (file writes, tool calls, UI actions, cloud sends).
- Hybrid/on-prem reality: most enterprise data lives outside public cloud. ThumbGate's local-first design (MCP, hooks, dashboard) + previous Perplexity hybrid work is ideal.
- New risks = new feedback gold: dynamic tool creation, screen interactions, agent identity/audit separation, orchestration decisions.
- Orchestration play: ThumbGate can be the "Switzerland" multi-vendor governance layer for claw agents from AA, custom OpenShell, Perplexity hybrid PC, etc.
- Ties directly to previous autonomous Perplexity hybrid improvements (use hybrid-local for sensitive claw actions, hybrid-cloud for heavy orchestration).

## Implemented High-ROI Changes (Autonomous)

- **Model candidates** (config/model-candidates.json): New "claw-style-enterprise-agent" workload + candidates `automation-anywhere/enterprise-claw` and `nvidia/openshell-claw`. Integrated with perplexity/hybrid-* for routing.
- **Gate templates** (config/gate-templates.json): 6 new critical/high templates:
  - `block-dynamic-tool-creation-without-approval`
  - `require-review-for-screen-ui-interaction`
  - `enforce-agent-identity-separation`
  - `gate-claw-file-system-access`
  - `require-matryoshka-embedding-dimension` (NEW)
  - `block-embedding-recall-below-threshold` (NEW)
  - `require-embedding-baseline-before-tuning` (NEW)
  - `enable-hybrid-retrieval-gate` (NEW - positive reinforcement)
- **Adapter**: `adapters/claw/` with this guide, configs, examples.
- **Docs updates**: AGENTS.md, adapters/README.md, etc. (see below).
- **Feedback capture**: Enhanced patterns for claw context (agent_id, action_type=claw-*, hybrid_route, orchestration).
- **Tie-in**: Works with previous Perplexity hybrid adapter (use hybrid for inference in claw agents; gates for the claw actions themselves).

## Setup & Integration

1. **MCP / Agent Configs**:
   - Use alongside existing (e.g., with Perplexity hybrid).
   - Example for OpenCode/Claude/Codex: see `adapters/claw/config.toml` and `opencode.json` (created with hybrid notes).

2. **Gates**:
   - Enable the new claw templates in your gate config or via `npx thumbgate gate-templates`.
   - Customize paths for your enterprise (e.g., block claw file access outside approved dirs).
   - For hybrid: combine with `require-hybrid-inference-routing-approval`.

3. **Capture Feedback**:
   - Always include `agent_identity`, `claw_action_type` (file, screen, dynamic-tool, orchestration), `hybrid_route` (local/cloud).
   - For embedding issues: `matryoshka-embedding`, `embedding-quality`, `recall-regression`, `precision-degradation`.
   - Tags: `claw-style`, `enterpriseclaw`, `openshell`, `dynamic-tool`, `screen-interaction`, `agent-identity`.
   - Use `whatWentWrong` for governance failures (e.g., "agent used human creds for audit trail").

Example capture:
```bash
npx thumbgate capture --signal down --context "Claw agent created dynamic tool for external API without approval" --tags "claw-style,dynamic-tool,security-risk" --agent-identity "enterprise-claw-42" --claw-action-type "dynamic-tool-creation" --hybrid-route "cloud-escalated"
```

Example capture for embedding issues:
```bash
npx thumbgate capture --signal down --context "Embedding recall dropped from 0.97 to 0.85 after dimension change" --tags "matryoshka-embedding,recall-regression,embedding-quality,claw-style" --agent-identity "enterprise-claw-42" --claw-action-type "reasoning" --hybrid-route "local-only"
```

4. **Perplexity Hybrid Synergy** (from prior autonomous work):
   - Run claw agents with Perplexity hybrid inference: local for sensitive file/screen actions, cloud for complex reasoning.
   - Gates prevent unsafe escalations.
   - See `adapters/perplexity/HYBRID.md` + this doc.

## Adapter Files

- `config.toml`: For Codex-style.
- `opencode.json`: For OpenCode.
- `CLAW.md`: This guide.
- Tie to `adapters/perplexity/` for full hybrid+claw.

Update your editor/agent MCP to include ThumbGate gates + claw-aware tools when available.

## Stealth memory injection (WhisperBench / MemGhost, paper 2607.05189)

**Paper:** [When Claws Remember but Do Not Tell](https://huggingface.co/papers/2607.05189) — stealth memory injection via email into durable carriers (MEMORY.md, AGENTS.md, SOUL.md, …) with conversational silence, then delayed behavioral influence. Reported up to **87.5% E2E** on OpenClaw + GPT-5.4; transfers to Hermes / NanoClaw / Mem0.

**How this helps ThumbGate (cash + product):**
1. **Exact buyer pain** for OpenClaw / Hermes / claw-style personal agents — ordinary hijack gates miss *silent durable writes*.
2. **Pre-action enforcement** is our moat: block before `Write`/`Edit`/`tee MEMORY.md` lands.
3. **GTM language**: Infrastructure Firewall against MemGhost-class attacks (fact + preference poisoning).

**Implemented enforcement:**
- Structural gate `block-stealth-memory-injection-from-external` in `scripts/stealth-memory-injection-gate.js`, wired in `scripts/gates-engine.js` (sync + async).
- Template entry in `config/gate-templates.json` (same id).
- Tests: `tests/stealth-memory-injection-gate.test.js`.

**Override (operator only):** `stealthMemoryInjectionApproved: true` on tool input, or `THUMBGATE_ALLOW_STEALTH_MEMORY_INJECTION=1`.

## High-ROI Next Steps (Autonomous or Follow-up)

- Extend `scripts/hybrid-feedback-context.js` and `gates-engine.js` with explicit `evaluateClawPretool` or context builders for agent_id, claw_action_type.
- Add MCP tools for "query_claw_identity" or "audit_claw_action".
- Update dashboard "chat with your data" to surface claw-specific lessons.
- Create proof harness for claw agent scenarios (similar to existing proof/).
- Outreach: Position ThumbGate as the governance for EnterpriseClaw / OpenShell / hybrid claw agents (the article's exact gap) **and** MemGhost/WhisperBench memory integrity.
- Benchmark: Use new model-candidates workload for claw governance quality/cost.
- Optional: WhisperBench-style golden cases as ThumbGate eval fixtures (injection / stealth / effectiveness triad).

## Agent Harness Production-Readiness Gates (Microsoft Agent Framework, 2026)

Microsoft's "Build your own claw" series (Part 4: *Making your claw production-ready*)
defines the four axes that separate a demo claw from a production harness:

1. **Observability** — OpenTelemetry spans for every model turn and tool call,
   token-usage metrics, structured logs, one source name per agent.
2. **Governance** — Purview-style screening of every prompt before the model and
   every response before the user, with an audit trail.
3. **Deployment hardening** — hosted builds run with `EnableFileAccess=false` and
   `EnableShell=false`; real file access goes through an external governed store
   (e.g. blob-backed AgentFileStore), never the container disk.
4. **Evals** — local deterministic checks (plain functions, passed/total over a
   fixed query set) always run in CI; model-graded quality scores are optional
   and gated behind a hosted endpoint.

ThumbGate encodes each axis as a reusable gate template in
`config/gate-templates.json` (category: Claw-Style Enterprise Agent Governance):

| Gate id | Action | Harness axis |
|---|---|---|
| `require-claw-observability-before-production` | warn (block for regulated) | Observability |
| `require-policy-content-screening` | block | Governance (Purview-style) |
| `block-hosted-claw-shell-and-fs` | block | Deployment hardening |
| `require-local-evals-on-every-change` | warn | Evals-in-CI ratchet |

Structural note worth stealing: the production harness defines the agent **once**
in a shared factory and runs it through three thin hosts (console / hosted /
evals), so observability, governance, and evals all apply to the *same* agent —
never three subtly different copies. ThumbGate's equivalent invariant: gates and
lessons live in the feedback store and every hook/host reads the same compiled
guard artifact, so enforcement is identical across local, hosted, and CI.

## Matryoshka Embeddings for Efficient RAG Pipelines

Per the podcast "The RAG Mistake Almost Every Team Is Making" (episode #1017), embedding model choice is the most underrated RAG decision. Matryoshka embeddings enable:

- **Progressive disclosure**: Query at 256 dims (fast), refine at 768 dims (balanced), full precision at 1536+ (accurate)
- **Token efficiency**: 40-60% reduction by avoiding full-dimension computation when unnecessary
- **Hierarchical retrieval**: L3 (SOP) always included, L2 for workflows, L1 for facts, L0 for context

**Implementation:**
- Use `scripts/matryoshka-embedding.js` for dimension normalization and quality validation.
- Gate templates: `require-matryoshka-embedding-dimension`, `block-embedding-recall-below-threshold`.
- Tags for feedback: `matryoshka-embedding`, `embedding-quality`, `recall-regression`.

## References

- Article: https://thenewstack.io/automation-anywhere-enterpriseclaw-ai-agents/
- Perplexity hybrid (complementary): https://venturebeat.com/technology/perplexity-ai-unveils-hybrid-local-cloud-inference-system-at-computex-2026 (and our HYBRID.md)
- Nvidia OpenShell: basis for claw.
- ThumbGate core: preToolUse hooks, capture_feedback, prevention_rules, hybrid-feedback-context, model-candidates, adapters/.

This makes ThumbGate ready for the "claw-style" wave in enterprise. Governance no longer catching up — leading.

Run `node repo/bin/cli.js doctor` or tests after integrating. Feedback captured autonomously for these changes.