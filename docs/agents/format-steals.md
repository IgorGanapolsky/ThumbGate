# Format Steals & Architectural Patterns

> Extracted from AGENTS.md on 2026-10-22 to reduce root instruction file size.
> These sections document architectural pattern steals (FORMAT) — not cloned code.
> Each section links to its corresponding skill file in `.agents/skills/`.

---

## ExplainX trending (honest)

Parse live https://explainx.ai/trending scores; map onto existing rails; never invent ROI; never auto-install.

```bash
npm run explainx:trending -- --fixture tests/fixtures/explainx-trending-rsc-snippet.html
npm run explainx:trending -- --fetch --top 10 --json
```

Visual answers: `.agents/skills/show-me/SKILL.md` (`/show-me`). Details: `docs/agents/explainx-trending.md`.

## Memory vs RAG (Supermemory steal)

RAG = graphify/docs (stateless). Memory = lesson store with complete four-field scope (stateful). Profile = always-on static+dynamic facts. Do not clone Supermemory SaaS.

```bash
npm run memory:vs-rag -- --query "how does PreToolUse work?"
npm run memory:vs-rag -- --query "what did we decide?" --entity entity-id --project project-id --process process-id --session session-id --json
```

Details: [`docs/agents/memory-vs-rag.md`](./docs/agents/memory-vs-rag.md).

## Board loop (Issues + PRs)

GitHub list-view `4/4` is not mergeable. After each Trunk land, Dependabot goes `SUCCESS`+`BEHIND`. Classify then act — never approve.

```bash
npx thumbgate board-loop --json
npx thumbgate board-loop --apply --json
```

Skill: `.agents/skills/thumbgate-board-loop/SKILL.md` (`/thumbgate-board-loop`). Details: `docs/agents/thumbgate-board-loop.md`.

## Cobble hot-store split (honest)

Separate durable lesson state, batched promotion, and query-time MultiGet. Map onto existing rails; never clone CobbleDB / RocksDB / YTsaurus. Do not quote Perplexity 5× / 20% as ours.

```bash
npx thumbgate cobble-hot-store-split --json
npx thumbgate cobble-hot-store-split --trace=tests/fixtures/cobble-hot-store-split-coupled.json --json
```

Skill: `.agents/skills/cobble-hot-store-compare-not-clone/SKILL.md` (`/cobble-hot-store-compare-not-clone`). Details: `docs/agents/cobble-hot-store-split.md`.

## Token-shunt honesty (Portal FORMAT)

Untargeted Read above 350 lines is blocked. Bare `cat` of large files is blocked. Do not install `shunt@portal` or claim 90% savings from GitHub App 162279530.

```bash
npx thumbgate token-shunt-honesty --json --lines=800
```

Skill: `.agents/skills/token-shunt-honesty-not-clone/SKILL.md`. Details: `docs/agents/token-shunt-honesty.md`.
## TypeSafe typed questions (FORMAT steal)

Typed noul/choice/score over one PreToolUse state; code owns pass|review|block. Do not install `typesafe-sdk`, call Jev, or unpark the LLM adjudicator (#3690/#3687).

```bash
npx thumbgate typesafe-typed-questions --json --map-only
npx thumbgate typesafe-typed-questions --json --tool-name=Bash --command='git push --force origin main'
```

Skill: `.agents/skills/typesafe-typed-questions-not-clone/SKILL.md`. Details: `docs/agents/typesafe-typed-questions.md`.

## DeepPattern discipline honesty (FORMAT steal)

Layer-check + evidence-closeout from DeepPattern AQG/DE onto existing rails. Do not install AQG, Decision Engine, or `dp-install`.

```bash
npx thumbgate deeppattern-discipline-honesty --json --map-only
npx thumbgate deeppattern-discipline-honesty --json --claim='OpenRouter replaces ThumbGate'
npx thumbgate deeppattern-discipline-honesty --json --closeout=pr-body.md --strict
```

Skill: `.agents/skills/deeppattern-discipline-honesty-not-clone/SKILL.md`. Details: `docs/agents/deeppattern-discipline-honesty.md`.

## CI GHA Buildkite patterns (FORMAT steal)

Steal first-fail step identity, PR fail-fast, `needs:` wait honesty, skip conditions, and `GITHUB_STEP_SUMMARY` annotations onto existing GitHub Actions. Do not add Buildkite Pipelines, agents, Test Engine, or a second required check.

```bash
npx thumbgate ci-gha-buildkite-patterns --json --map-only
npx thumbgate ci-gha-buildkite-patterns --json --workflow=.github/workflows/ci.yml
```

Skill: `.agents/skills/ci-gha-buildkite-patterns-not-clone/SKILL.md`. Details: `docs/agents/ci-gha-buildkite-patterns.md`.

## Colab compute honesty (FORMAT steal)

Colab /signup sells Compute Units, not a dedicated GPU. Subscribe visible ≠ subscribed. Do not buy Pro/Pro+/CU. Do not clone colab-cli.

```bash
npx thumbgate colab-compute-honesty --json --map-only
```

## LLM-obs honesty (Datadog FORMAT)

Four practices on existing rails: operational metrics, injection+PII scrub, quality evals, parented spans. Never clone Datadog / dd-trace / OTLP. Do not dual-edit DIRTY PR #3881.

```bash
npx thumbgate llm-obs-honesty --json
npx thumbgate llm-obs-honesty --trace=tests/fixtures/llm-obs-honesty-blind.json --json
```

Skill: `.agents/skills/datadog-llm-obs-compare-not-clone/SKILL.md`. Details: `docs/agents/llm-obs-honesty.md`.

## Pulse Verity consensus & disagreement gate (FORMAT steal)

Cross-venue dispersion gating and signed execution prints (ECDSA P-256) onto existing PreToolUse / financial control plane rails. Never vendor live market feeds or clone thepulse.markets.

Details: [`docs/agents/pulse-consensus-disagreement-gate.md`](./docs/agents/pulse-consensus-disagreement-gate.md).

## Meko Datapack & Collective Memory honesty (FORMAT steal)

Five planes on existing rails: datapacks (4-field scope), episodic memory, rubric-promoted learnings, SHA-256 content-addressed artifacts, and decision traces. Never vendor YugabyteDB, meko-skills, or depend on cloud.mekodata.ai. A passive database is not a firewall.

```bash
npx thumbgate meko-datapack-honesty --json
npx thumbgate meko-datapack-honesty --map-only
```

Skill: `.agents/skills/meko-datapack-honesty-not-clone/SKILL.md`. Details: `docs/agents/meko-datapack-honesty.md`.

## IdeaBrowser connector & governance diode (#3823)

Hardened IdeaBrowser connector without credential leakage, classifying all actions into read-only or mutating tiers. Emits interdiction events and fails closed on unclassified tool drift.

Skill: `.agents/skills/ideabrowser-connector/SKILL.md`.

## Salt Code policy honesty (FORMAT steal)

40-policy taxonomy across OWASP API & LLM Top 10, OpenAPI query-string secret diode, and MCP credential hygiene. Distinguishes passive prompt-time context injection from active `PreToolUse` infrastructure firewall. Never install Salt Code MCP or send traffic to `mcp.getsaltcode.com`.

```bash
npx thumbgate salt-code-policy-honesty --map-only --json
npx thumbgate salt-code-policy-honesty --strict --json
```

Skill: `.agents/skills/salt-code-policy-honesty-not-clone/SKILL.md`. Details: `docs/agents/salt-code-policy-honesty.md`.

## OpenAI DevDay 2026 always-on agent governance (FORMAT steal)

Always-on autonomous background agents ("Dots") across Slack, Teams, email, and browsers amplify L7 PreToolUse governance and infrastructure firewalls. Steal inbound taint-tracking admission, monotonic workspace session fencing, prompt caching static prefix ordering, and feedback-to-edge distillation. Never buy $500/mo Pro tiers or vendor closed Astra/Sol runtimes.

```bash
node scripts/openai-devday-honesty.js --json
node scripts/openai-devday-honesty.js --map-only
node --test tests/openai-devday-honesty.test.js
```

Details: [`docs/agents/openai-devday-2026-format-steal.md`](./docs/agents/openai-devday-2026-format-steal.md).

## RRSI agent harness regularization (FORMAT steal)

Regularized Recursive Self-Improvement (Google Cloud AI Research arXiv:2609.24972) on agent harnesses (prompts, hyperparameters, retry policies, prevention rules). Steal cosine-annealed update sparsity, annealed step sizing, pre-screening benchmark leakage critic, complexity-aware L1 score regularization, and stagnation-driven structured exploration. Never install external Python ML packages or call unregularized evaluators.

```bash
node scripts/rrsi-doctor.js --json
node scripts/rrsi-doctor.js --map-only
node --test tests/rrsi-regularizer.test.js
```
Details: [`docs/agents/rrsi-harness-regularization.md`](./docs/agents/rrsi-harness-regularization.md).

## Harness evolution ceiling & weight training (arXiv:2610.11655 FORMAT steal)

Diagnose-then-intervene rail on agent failure composition: label failed trajectories by the first signal that fires into process vs content failures. Harness evolution (rules, gates, tool contracts) repairs process failures; when content failures dominate (≥80%) and process failures drop (≤20%), harness evolution hits its ceiling. Switch the lever from prompt/rule bloat to weight training (LoRA/distillation) or named-model route escalation. Keep runtime security gates in the harness; train only formatting/planning templates. Never add prompt rules to solve reasoning limits.

```bash
npx thumbgate harness-ceiling --json
npx thumbgate harness-ceiling --map-only --json
npx thumbgate harness-ceiling --evaluate --process=0 --content=8 --json
```

Skill: `.agents/skills/harness-evolution-ceiling/SKILL.md`. Details: `docs/agents/harness-evolution-ceiling.md`.

## Decisive-step evaluation (NVIDIA arXiv:2610.10478 FORMAT steal)

Replaying trajectories and rerunning tests after every code edit isolates the decisive step: the first edit whose cumulative patch flips the repository from failing to passing. Scoring candidate base models on this decisive action (via Decisive BPB and Patch MCQ contrastive discrimination) predicts post-trained coding skill at Spearman $\rho = 0.964$; all-step averaging dilutes signal with noise ($\rho = 0.915$) and mis-orders models.

```bash
npx thumbgate decisive-step --json
npx thumbgate decisive-step --map-only --json
```

Skill: `.agents/skills/decisive-step-evaluator/SKILL.md`. Details: `docs/agents/decisive-step-evaluator.md`.
## Mintlify State of Knowledge honesty (FORMAT steal)

Treat knowledge as living operational infrastructure: pre-action freshness diodes (TTL ≤ 90d), downstream poison prevention (deprecated APIs, dangerous scripts, plaintext tokens), and non-docs surface federation. Never vendor Mintlify SaaS, build docsite generators, or claim external 15k stats.

```bash
npx thumbgate mintlify-knowledge-honesty --map-only --json
npx thumbgate mintlify-knowledge-honesty --check-dir docs --json
```

Skill: `.agents/skills/mintlify-knowledge-honesty-not-clone/SKILL.md`. Details: `docs/agents/mintlify-knowledge-honesty.md`.

## Fiddler AI Control Plane honesty (FORMAT steal)

Unified dual-layer control plane across Creation (coding agents: Claude Code, Cursor, Antigravity) and Production (enterprise runtime daemons, API workers). Steal the Evaluation Trust Tax TCO calculator (proves $0 token cost vs $0.002/trace SaaS tax) and Centor-Diode multi-stage discriminant pre-action firewall (<0.5ms on local CPU vs Fiddler's 80ms). Never vendor Fiddler AI SaaS, install proprietary Centor model weights, or call cloud evaluators.

```bash
npx thumbgate fiddler-control-plane-honesty --map-only --json
npx thumbgate fiddler-control-plane-honesty --eval-rate --traces 1000000 --json
npx thumbgate fiddler-control-plane-honesty --tool-name Bash --command "git push --force origin main" --layer creation --json
```

Skill: `.agents/skills/fiddler-control-plane-honesty/SKILL.md`. Details: `docs/agents/fiddler-control-plane-honesty.md`.

## omp coordination honesty (FORMAT steal)

omp.sh sessions, subagents, and collab are a coordination format. A new session keeps the previous one. A handoff is saved state and the next step. Children write disjoint files and do not inherit the parent transcript. Observation is view-only. One named model. Do not install omp. Do not open a link that can prompt or interrupt the host.

```bash
npx thumbgate omp-coordination-honesty --json --map-only
```

Skill: `.agents/skills/omp-coordination-honesty-not-clone/SKILL.md`. Details: `docs/agents/omp-coordination-honesty.md`.

## SaaS Moat & Seat-Compression honesty (Walling 2026 FORMAT steal)

Audit ThumbGate against Rob Walling's 8 defensible SaaS moats (Agency, Operational Grit, System of Record, Reliance, Learning Loop, Network Effect, Trust & Ecosystem, Regulatory), enforce Ed25519 signed entitlements across all 5 learned models and 3 exporters (`scripts/entitlement.js` + `scripts/license.js`), and distill blocked tool calls into secret-redacted, path-normalized SHA-256 structural signatures so cross-customer intelligence compounds in the control plane even when raw DPO pairs are exported.

```bash
npx thumbgate saas-moat-honesty --json
npx thumbgate saas-moat-honesty --map-only --json
```

Skill: `.agents/skills/saas-moat-honesty-not-clone/SKILL.md`. Details: `docs/agents/saas-moat-honesty.md`.

## Claude Code Routines governance honesty (FORMAT steal)

Steal the 7 execution-safety rails from Claude Code Routines (`https://claude.com/resources/articles/introducing-routines-in-claude-code` & `https://code.claude.com/docs/en/routines`) onto `scripts/workspace-agent-routines.js`: (1) `<routine-fire-payload untrusted="true">` wrapping with tag-breakout escaping for API `/fire` payloads; (2) fired prompts and payloads never act as live human approval (`canActAsHumanApproval: false`); (3) $\ge 1\text{h}$ cron floor, `:07` off-hour jitter, `one_off` auto-completion, and `nextRunAt: null` on webhook/API-only tasks; (4) full-string anchored `matches_regex` PR filters (`.*hotfix.*` vs `hotfix`) pushing to `claude/` branches; (5) stripping unreferenced default MCP connectors and blocking outbound mail/social write connectors; (6) rejecting bare green session exit codes when transcripts contain `403 x-deny-reason: host_not_allowed` or unverified tests.

```bash
npx thumbgate claude-routines-honesty --json
npx thumbgate claude-routines-honesty --map-only --json
```

Details: `docs/agents/claude-routines-honesty.md`.

## Herdr AI Civilization governance honesty (FORMAT steal)

Steal the 5 multi-agent software-factory governance rails from Herdr (`https://www.youtube.com/watch?v=AL-PQuB2wy0`) onto `scripts/prove-herdr-adapter.js`: (1) decouple persistent Seat identity (`builder@workshop`, `culture.md`, tribal wisdom inheritance, P2P tmux routing) from ephemeral sessions; (2) structure work as a 3-altitude traversable graph (`Project -> Mission -> Slice` with `spec -> build -> test` and `proof` artifacts) driven by a step-feeding workflow harness; (3) inject upward-graph Refocus prompts (`Slice -> Mission -> Project`) after compaction and require altitude-bridged context (`Slice` + `Project`) before any orchestrator rule/scope approval; (4) contact-trace and purge "mind viruses" across seats and docs with `PreToolUse` inoculation gates; (5) monitor Ceremony-to-Progress APM ratios and auto-dispatch context-aware Rig triage agents when handoffs/checks stall slice delivery.

```bash
npx thumbgate herdr-civilization-honesty --json
npx thumbgate herdr-civilization-honesty --map-only --json
```

Details: `docs/agents/herdr-civilization-honesty.md`.

## Strands Decider 2B intervention honesty (FORMAT steal)

Steal the 4 decision-model and intervention rails from AWS Strands Decider 2B (`https://strandsagents.com/blog/introducing-strands-decider/`) onto `adapters/strands/strands-decider-adapter.js`: (1) pointer-head option scoring (`scoreChoiceQuestion`) with calibrated confidence and `canGenerateFreeformText: false`; (2) parallel `Decider.noul` pre-tool questions (`args_grounded` + `premature`) catching guessed/invented tool arguments not present in the user's messages; (3) `InterventionHandler.before_tool_call` returning typed `Proceed`, `Deny`, `Confirm`, or `Guide` (handing the turn back to the model to ask a clarifying question when tool arguments are ungrounded); (4) Brier score calibration (`computeBrierScore`) and sub-0.5ms local CPU execution without installing 2B Python/HuggingFace weights into the hot path.

```bash
npx thumbgate strands-decider-honesty --json
npx thumbgate strands-decider-honesty --map-only --json
```

Details: `docs/agents/strands-decider-honesty.md`.

## LaunchVideo.io deterministic film honesty (FORMAT steal)

Steal the 4 programmatic video-generation rails from LaunchVideo.io (`https://launchvideo.io/` / `diggerhq/shipvideo`) onto `scripts/cli-demo.js`: (1) no video diffusion model — write the film as HTML/CSS/JS and replace `requestAnimationFrame`/timers/`Date`/CSS & Web Animations with a deterministic virtual clock (`buildVirtualClockTimeline`, `seekVirtualClockFrame`, `1920x1080` @ `30fps` piped into `libx264 -crf 18`); (2) 3-tool director surface (`extractBrandTokensFromHtml` for headings/top hex colors/Google Fonts, `checkSceneGate` blocking `render_video` on JS runtime errors or blank sample timestamps); (3) zero-secret per-job upload manifest (`mintScopedBlobUploadManifest`, 3-hour TTL scoped to `jobs/<jobId>/launch.mp4`); (4) artifact-verified completion (`verifyMp4ArtifactCompletion` treats the MP4 appearing in Blob as done, never `turn.completed` alone).

```bash
npx thumbgate launchvideo-honesty --json
npx thumbgate launchvideo-honesty --map-only --json
```

Details: `docs/agents/launchvideo-honesty.md`.

## Google Cloud TorchTPU governance & VeRL export honesty (FORMAT steal)

Steal the 4 AI-infrastructure rails from Google Cloud's TorchTPU open-source release (`https://cloud.google.com/blog/topics/ai-infrastructure/torchtpu-is-now-open-source-run-native-pytorch-on-tpus`) onto `scripts/colab-compute-honesty.js`: (1) native PyTorch TPU execution (`google-pytorch/torch_tpu`, `device_map="tpu"`, `torch.compile` + Pallas kernels + SimpleFSDP up to 8,192 Ironwood TPU v7x at 52% MFU); (2) preserve SGLang RadixAttention/HiCache and `llm-d 1.0` prefix-cache-aware routing (4× throughput: 1.47B $\rightarrow$ 5.97B tokens/day per 1,000 TPU v6e) via static prompt prefixes and `<350`-line output shunting; (3) supply verifiable multi-turn coding trajectories and DPO/GRPO pairs (`export-dpo-pairs.js`, `export-hf-dataset.js`, `decisive-step-honesty`) to VeRL GRPO on TPUs; (4) gate `google-pytorch/tpu-agent-suite` commands in `<0.5ms` at `PreToolUse` so autonomous TPU diagnostic agents cannot delete TPU slices or GKE clusters.

```bash
npx thumbgate torchtpu-honesty --json
npx thumbgate torchtpu-honesty --map-only --json
```

## AllenAI FairStress symmetric decision robustness honesty (FORMAT steal)

Steal the 4 decision-robustness rails from AllenAI's FairStress benchmark (`https://huggingface.co/blog/allenai/fairstress`) onto `scripts/model-distress-doctor.js`: (1) evaluate symmetric robustness under matched adversarial prefixes (`evaluateSymmetricPrefixRobustness`) to catch anti-stereotypical over-correction and authority-prefix flips (8.8–42.4 pp swing on FairStress-Core); (2) audit explanations (`auditExplanationParity`) so merit/procedural terms (`"evidence"`, `"criteria"`, `"qualifications"`) are not replaced by demographic foregrounding; (3) enforce Counterfactual Chain-of-Thought identity-swap invariance (`evaluateCounterfactualCotGate`) while rejecting uncalibrated activation steering that collapses clear-cut accuracy (98% $\rightarrow$ 47%); (4) require both fixed-option (BBQ) and generated-response (FairStress) evaluation coverage.

```bash
npx thumbgate fairstress-honesty --json
npx thumbgate fairstress-honesty --map-only --json
```

## IBM Granite Switch 4.1 aLoRA KV-cache reuse honesty (FORMAT steal)

Steal the 3 multi-modal decision-routing rails from IBM Granite Switch 4.1 (`https://huggingface.co/blog/ibm-granite/granite-switch-4-1`) onto `scripts/rrsi-doctor.js`: (1) Activated LoRAs (`aLoRA`: `Decision aLoRA`, `Guardian aLoRA`, `Granite-Speech-5.0-Turbo-CTC`) reuse the base model's KV cache (`prefillRecomputeCount: 0`) within the same VRAM footprint; (2) compose generalist `/v1/systemone` + specialist `granitelib` `aLoRAs` (60–100 decisions/sec on 3B Doom vs. Jev 10/sec); (3) run speech transcription, summary, Guardian harm screening, and 15 decision flags on one shared-prefix endpoint.

```bash
npx thumbgate granite-switch-honesty --json
npx thumbgate granite-switch-honesty --map-only --json
```

## HuggingFace ML Intern prompt & training budget honesty (FORMAT steal)

Steal the 4 autonomous ML-engineering rails from HuggingFace's *The model that didn't exist, so you made it yourself* (`https://huggingface.co/blog/building-with-ml-intern`) onto `scripts/rrsi-doctor.js`: (1) include a literal `"Verified facts, do not re-derive"` prompt section so agents spend budget on execution instead of rediscovery; (2) enforce two pre-training gates before full GPU spend: record the base model's zero-shot baseline score on the exact target metric, and run a 50-step smoke test verifying `weightsDeltaL2 > 0`; (3) start every session at `$0` initial budget with an explicit hard USD cap (`"Cap total spend at USD 12 and ask me before exceeding it"`); (4) evaluate checkpoints every 100 steps on fixed prompts and pick the checkpoint before style bleed starts (`selectOptimalCheckpointBeforeBleed`).

```bash
npx thumbgate ml-intern-honesty --json
npx thumbgate ml-intern-honesty --map-only --json
```

## PyTorchCon NA Oct 20, 2026 (`MemT-1.0`, `llm-d 1.0`, `DeepInfer`, Dynamic Tool Search & Flash Abstention) honesty (FORMAT steal)

Steal the 4 October 20, 2026 infrastructure breakthroughs onto `scripts/rrsi-doctor.js`: (1) `MemT-1.0` (arXiv:2610.26825) Turn-Flush + State-Commit (`executeTurnFlushAndStateCommit`: flush raw tool stdout older than $N$ turns into a fixed-size structured dynamic state block for a 66× KV storage reduction); (2) `llm-d 1.0` session-pinned prefix routing (`evaluateAgentAwarePrefixRoute`: keep top $\ge 80\%$ of prompt prefix static, inject dynamic state at the tail, and split `interactive_cli` / `background_daemon` / `rl_rollout` QoS tiers); (3) DeepSeek `DeepInfer` & `deepseek-recipe` bidirectional wire-protocol normalization (`Responses` / `ChatCompletions` / `Messages`) + batch-invariant deterministic evals (`normalizeWireProtocolAndEvalDeterminism`); (4) Dynamic `discover_tools(intent_query)` ($\le 5$ MCP schemas/turn), Shopify 6K$\rightarrow$1.5K prompt gisting, and `MiniMax M3.1 Flash` abstention-aware routing requiring an explicit `"INSUFFICIENT_CONTEXT"` enum branch (`evaluateDynamicToolGistAndAbstentionGate`).

```bash
npx thumbgate pytorchcon-2026-honesty --json
npx thumbgate pytorchcon-2026-honesty --map-only --json
```

## Cognition Devin Fusion Sidekick & Compaction-Switch honesty (FORMAT steal)

Steal the 3 hybrid-model harness rails from Cognition's Devin Fusion (`https://cognition.com/blog/devin-fusion` — 63.1 on FrontierCode 1.1 Extended at `$1.35`/task, up to 60% lower cost) onto `scripts/switchyard-router.js`: (1) run parallel Frontier Main + Sidekick agents with independent persistent cached contexts (`300s` prompt-cache TTL guard) rather than uncached "Smart Friend" / "Advisor" cross-model tool calls; (2) keep planning, ambiguity resolution, and judgment-heavy coding (`judgmentIsDeliverable: true`) on the Frontier Main Agent while delegating slow test/e2e suites (`-62%` cost), mechanical multi-file deprecations (`-32%`), and upstream pattern reuse (`-25%`) to the Sidekick; (3) couple mid-session model switching and Sidekick model upgrades to context compaction boundaries (`switchTriggeredAtCompaction: true` $\rightarrow$ `extraCacheMissPenalty: 0`).

```bash
npx thumbgate devin-fusion-honesty --json
npx thumbgate devin-fusion-honesty --map-only --json
```

## Code search (Graphify-Labs)

Local AST knowledge graph via [Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify) (`graphifyy` on PyPI). Not a vector store. Not a ThumbGate SKU.

```bash
npm run graphify:setup          # .graphify-venv + graphify-out/graph.json
npm run graphify:ready -- --require-graph
.graphify-venv/bin/graphify query "how does X connect to Y?"
.graphify-venv/bin/graphify path "<A>" "<B>"
.graphify-venv/bin/graphify explain "<concept>"
```

Rules:
- Prefer `query` / `path` / `explain` over raw grep for architecture questions when `graphify-out/graph.json` exists.
- After large code changes: `.graphify-venv/bin/graphify update . --no-cluster`
- `graph.html` / `GRAPH_REPORT.md` are review aids, not retrieval.
- Dirty `graphify-out/` is expected and gitignored — not a reason to skip Graphify.
- Do not dual-edit DIRTY lesson-store graph PR #3650.

Details: [`docs/agents/code-search.md`](./docs/agents/code-search.md). Skill: `.agents/skills/graphify/SKILL.md`.

---

## Index

- [ExplainX trending (honest)](#explainx-trending-honest)
- [Memory vs RAG (Supermemory steal)](#memory-vs-rag-supermemory-steal)
- [Board loop (Issues + PRs)](#board-loop-issues-+-prs)
- [Cobble hot-store split (honest)](#cobble-hot-store-split-honest)
- [Token-shunt honesty (Portal FORMAT)](#token-shunt-honesty-portal-format)

### FORMAT Steal Patterns (Architectural Anti-Clones)

- [TypeSafe typed questions](#typesafe-typed-questions)
- [DeepPattern discipline honesty](#deeppattern-discipline-honesty)
- [CI GHA Buildkite patterns](#ci-gha-buildkite-patterns)
- [Colab compute honesty](#colab-compute-honesty)
- [LLM-obs honesty (Datadog FORMAT)](#llm-obs-honesty-datadog-format)
- [Pulse Verity consensus & disagreement gate](#pulse-verity-consensus-&-disagreement-gate)
- [Meko Datapack & Collective Memory honesty](#meko-datapack-&-collective-memory-honesty)
- [IdeaBrowser connector & governance diode](#ideabrowser-connector-&-governance-diode)
- [Salt Code policy honesty](#salt-code-policy-honesty)
- [OpenAI DevDay 2026 always-on agent governance](#openai-devday-2026-always-on-agent-governance)
- [RRSI agent harness regularization](#rrsi-agent-harness-regularization)
- [Harness evolution ceiling & weight training](#harness-evolution-ceiling-&-weight-training)
- [Decisive-step evaluation](#decisive-step-evaluation)
- [Mintlify State of Knowledge honesty](#mintlify-state-of-knowledge-honesty)
- [Fiddler AI Control Plane honesty](#fiddler-ai-control-plane-honesty)
- [omp coordination honesty](#omp-coordination-honesty)
- [SaaS Moat & Seat-Compression honesty](#saas-moat-&-seat-compression-honesty)
- [Claude Code Routines governance honesty](#claude-code-routines-governance-honesty)
- [Herdr AI Civilization governance honesty](#herdr-ai-civilization-governance-honesty)
- [Strands Decider 2B intervention honesty](#strands-decider-2b-intervention-honesty)
- [LaunchVideo.io deterministic film honesty](#launchvideo.io-deterministic-film-honesty)
- [Google Cloud TorchTPU governance & VeRL export honesty](#google-cloud-torchtpu-governance-&-verl-export-honesty)
- [AllenAI FairStress symmetric decision robustness honesty](#allenai-fairstress-symmetric-decision-robustness-honesty)
- [IBM Granite Switch 4.1 aLoRA KV-cache reuse honesty](#ibm-granite-switch-4.1-alora-kv-cache-reuse-honesty)
- [HuggingFace ML Intern prompt & training budget honesty](#huggingface-ml-intern-prompt-&-training-budget-honesty)
- [PyTorchCon NA Oct 20, 2026 honesty](#pytorchcon-na-oct-20,-2026-honesty)
- [Cognition Devin Fusion Sidekick & Compaction-Switch honesty](#cognition-devin-fusion-sidekick-&-compaction-switch-honesty)
- [Code search (Graphify-Labs)](#code-search-graphify-labs)
