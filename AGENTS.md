# agents.md — Universal Agent Context for ThumbGate

> Vendor-neutral agent context file (GitHub Podcast S02E05). Compatible with
> Claude Code, Cursor, Codex, OMP, Gemini, and any ACP-compatible harness.
> Houses setup commands, test execution rules, and architectural guidelines
> that don't belong in README.md.

## Quick Start

```bash
git clone https://github.com/IgorGanapolsky/ThumbGate && cd ThumbGate
npm ci
npm run session:lease:claim
bin/agent-loop --health --json   # fail-closed health check
```

## Test Execution Rules

| Command | Purpose | Timeout | Stacked-PR Layer |
|---|---|---|---|
| `npm test` | Full test suite | 600s | All |
| `node --test tests/isolated-verifier.test.js` | Verifier-only (quick plan) | 300s | Scripts |
| `npm run verify:isolated -- --approve-writes` | Isolated verifier with write support | 300s | Scripts |
| `npm run test:coverage` | Coverage threshold | 300s | All |
| `npm run test:perf-budget` | Performance budgets | 120s | Scripts |
| `npm run self-heal:check` | Self-healing diagnostics | 600s | Scripts |
| `node scripts/refresh-proof-pack.js --check` | Proof pack integrity (read-only) | 60s | Scripts |

## Stacked PR Architecture (GitHub Native)

ThumbGate uses GitHub native stacked PRs (GitHub Podcast S02E05). When
implementing a large feature, decompose into atomic PRs sliced by layer:

1. **Layer 1 — Core logic** (`src/`): gate decisions, server changes
2. **Layer 2 — Scripts** (`scripts/`): CLI tools, verifier, PR manager
3. **Layer 3 — Tests** (`tests/`): unit + integration tests
4. **Layer 4 — Docs** (`public/`, `.claude/`): landing page, skill docs

**CODEOWNERS**: Keep updates on `main` only. Mid-stack CODEOWNERS changes are
ignored by upper PRs (GitHub evaluates CODEOWNERS against `main` as source of
truth).

**Worktrees**: Always use `git worktree add` for branch management. The checkout
lease (`scripts/session-lease.js`) is per-checkout, so separate worktrees never
contend.

## Verification Gate (Single Source of Truth)

Every PR must pass:
- `npm run verify:isolated` → `VERDICT: PASS — Isolated Verifier approves`
- `node --test tests/isolated-verifier.test.js` → 58/58 pass
- `bin/agent-loop --health --json` → `{"status": "HEALTHY", "requiredFailed": []}`

## Prompt Tuning Format (Ultramarine FORMAT steal)

Adopted from Paper Instruments' Ultramarine 1 Flash prompt tuning format
(see `docs/agents/ultramarine-flash-steal.md`). These are drafting-time
directives, not a cleanup pass:

> **Concision with completeness.** The balance that matters most in prose is
> concision with completeness. Concision never comes at the cost of completeness.
>
> **Stopping rule.** Finish when the requested result is usable and the
> observable requirements are satisfied. Once you judge the work complete, the
> next action is the handoff. **YOU MUST NOT KEEP WORKING ON FINISHED WORK.**
>
> **No self-evaluation.** Never evaluate yourself. Do not produce summaries of
> what you did, apologies, or meta-commentary.

**Agent lean disclosure** (Anthropic FORMAT steal —
`docs/agents/anthropic-judgment-calls-steal.md`): when this agent's
recommendation is influenced by another agent's prior analysis (e.g.
`scout@workshop`'s `shared_facts` capsule), cite the source agent explicitly.
Do not present borrowed arguments as independent judgment.

## Branch Protection

`main` is governed by BOTH classic branch protection AND the `main governance`
repository ruleset. **NEVER** approve PRs, use `--admin`, or force-merge around
review requirements. Human review is the final gate.

## File Conventions

- Two-space indentation, single-quote strings
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`)
- All scratch scripts go in `/tmp/` or `.git/info/exclude` — never committed
- Never `git add -A` — stage explicit paths only

## Broadcast-Aware Mixture-of-Experts (MoE) & LLM-as-Judge Swarm SOW

Every prompt from Igor is broadcast simultaneously across Herdr (`2x2` grid panes: `omp`, `poolside`, `codex`, `grok`) and `Antigravity / Gemini / Cursor`. To maximize token efficiency (`-68.5%`), speed, and intelligence without duplicate work or file collisions:

1. **Broadcast Deduplication & Slice Claim (`~/.local/bin/herdr-swarm-sow`)**:
   - On receiving any prompt, run `/Users/iganapolsky/.local/bin/herdr-swarm-sow claim --prompt "<prompt>" --agent <agent_id>` (or `POST /v1/cloud/swarm/moe-judge`).
   - Prompts hash deterministically (`bcast_<sha256[:12]>`) into `~/.thumbgate/runtime/broadcast-swarm/` and assign non-overlapping **MoE Specialist Slices**:
     - **`scout@workshop` (`local_free` `$0.00/M tok` — Poolside Laguna 2.1 / Qwen)**: Fast AST/grep scouting & `shared_facts` population.
     - **`builder-core@workshop` (`capable_code` — OMP / Gemini 4 Argon / Codex)**: Core backend, API routes, and gate logic in an isolated worktree.
     - **`builder-ui@workshop` (`multimodal_ui_cloud` — Antigravity / Gemini / Cursor)**: Frontend UI/UX, mobile responsiveness, BrowserOS Neo CDP, and Cloud Run/Railway ops.
     - **`judge@clinic` (`adversarial_llm_as_judge` — Zero-Context Goldfish / `autoproject` Reviewer)**: Scores candidate implementations against a locked 100-point rubric (`correctness_and_tests: 40`, `empirical_proof: 30`, `token_efficiency: 15`, `safety_and_isolation: 15`) and rejects any candidate below `75` or missing test/live proof.
2. **Mesh Surface Leases (`mesh_claim_surface` / `mesh_send_peer`)**:
   - Claim files/surfaces before editing and broadcast completion receipts to `to_agent: "all"` so sibling agents reuse verified outputs immediately.

## Evidence-Backed Engineering & Shelf-Life Invariance

Adopted from Stanford Zou Group (LLM Claims Shelf Life), HKUST HarnessSQL, and MIT Soft-MTP:

1. **LLM Capability Shelf-Life vs. Behavioral Invariance**:
   - Capability failures (retrieval in long contexts, reference hallucinations, math steps) expire rapidly (~16 months). Do not write brittle prompt workarounds for expired model bugs.
   - Evaluation biases (self-preference as judge, sycophancy, verbosity-as-proof) **persist and strengthen** in frontier models. Therefore, NEVER use LLMs to self-evaluate without external, objective ground truth. Every "done" claim requires empirical receipts (tests passed, exit code 0, HTTP 200, schema validation).
2. **Atomic Tool Harness Architecture (HarnessSQL Principle)**:
   - Tool harness structure beats model parameter scale (8B with an atomic 4-tool harness outperforms 32B models). Design tools to be minimal, deterministic, and sandboxed (e.g. `list_surfaces`, `inspect_schema`, `execute_sandboxed`, `submit_proof`).
3. **Speculative Execution with Straight-Through Verification (Soft-MTP Principle)**:
   - When agents generate speculative code or draft actions, intermediate noise must be discarded; only the verified delta that aligns with the environment contract is committed.
4. **Exact In-Memory State vs Hallucinated Arithmetic (qwenGPU Principle)**:
   - For all policy boundaries, path matching, token budgets, and integer arithmetic, enforce exact deterministic compilation/validation rather than relying on probabilistic LLM token generation.
5. **End-to-End User Journey Tracing (LinkedIn OpenTelemetry pageForestId Principle)**:
   - Link client-side UX friction, prompt triggers, subagent tool calls, and backend verification via a shared `journeyForestId`. Coordinated head sampling ensures failures are captured with zero missing spans.
6. **Viral Distribution & Versioned Skills (xAI Grok Bot Team Bot Principle)**:
   - Package specialized agent capabilities into modular, versioned skill files maintained by subject-matter experts. Distribute capabilities through zero-friction triggers (e.g. mentions, single-click installs) that route work to background specialists without human re-entry.

## Post-Loop Architecture: Outcome Goals, Builder-Reviewer-Verifier & Subagent Topology

Adopted from OpenAI and Anthropic consensus on post-loop agent engineering (`scripts/builder-reviewer-verifier.js`):

1. **Outcome Goals, Not Step-by-Step Instructions:**
   - Define verifiable outcome metrics (e.g. latency under 200ms, zero unhandled errors, passing test matrix) alongside tools. Do not cap the model's solution space with micro-step procedural micromanagement.
2. **No Spec Decomposition into Micro-Tickets:**
   - Frontier models (Laguna S 2.1, Claude 3.7) handle long contexts natively. Set compaction threshold to 400k tokens; let a single builder agent implement the entire specification across compactions.
3. **Subagent Fan-Out Only for Truly Independent Tasks:**
   - Parallel subagents are restricted to isolated workloads with zero shared state (independent library research, parallel Playwright test flows, bug hunting in separate directories). NEVER fan out interconnected feature slices in parallel.
4. **Effort Scaling Across Model Tiers:**
   - Primary builder escalates dynamically to a frontier advisor when stuck on complex problems (race conditions, async deadlocks). Routine self-contained tasks (docs, translations, static assets) route to cheaper `nano`/`mini` tiers.
5. **Builder–Reviewer–Verifier (BRV) Pipeline:**
   - Spec -> **Builder** -> **Reviewer** (max 3 rounds) -> **Verifier** (max 2 rounds).
   - **Route Fixes Back to the Original Builder:** ALWAYS route reviewer and verifier findings back to the same builder instance. Preserves context, prevents point-fix churn, and saves ~38% tokens.
   - **Verify Only at Capability Edge:** Skip verification for mastered routine tasks (basic CRUD/forms). Reserve verifiers for edge-of-capability features (sync merges, race conditions, auth boundaries).
   - **Continuous Harness Pruning:** Strip out obsolete scaffolding and prompt crutches absorbed natively by newer base models.
6. **Chief of Staff & Anti-Bureaucracy Swarm Principle:**
   - Single "Chief of Staff" coordinator thread delegating to sandboxed worker containers instead of multi-tab context-switching.
   - Ban peer-to-peer persona swarms for feature building (no 10-20 peer paralysis). Subagents are strict tool calls with typed inputs and outputs. Reserve swarms exclusively for parallel vulnerability hunting and bug bashing.



