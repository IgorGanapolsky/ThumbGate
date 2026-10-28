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

