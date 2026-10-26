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


## Pattern AI Labs AgentCall Meeting-Agent Voice Firewall & Atomic Canvas honesty (FORMAT steal)

Steal the 4 live-meeting agent patterns from Pattern AI Labs' AgentCall (`https://agentcall.dev` / `https://github.com/pattern-ai-labs/agentcall`) onto `scripts/rrsi-doctor.js` (`evaluateAgentCallMeetingGovernanceAndCanvasGate`) at `$0` outbound spend (never install `join-meeting` or buy per-minute `api.agentcall.dev` credits): (1) **Speaker-Diarized Voice-to-Tool Prompt Injection Firewall** — block unverified meeting participants (`transcript.final` arriving as raw agent stdin) from triggering `bash`/`write`/secret-exfil tools; (2) **Localhost Tunnel Port-Isolation** — block reverse tunnels from binding sensitive local ports (`3030`, `5432`, `6379`, `9011`, `9111`) and enforce ephemeral canvas ports; (3) **Atomic `screenshare.swap` + 2s `/state.json` Polling + Barge-In Sentence Cursor** — serialize stop-before-start transitions, poll deterministic local `state.json`, coalesce STT partials via VAD gap buffering, track `interruptedSentenceIndex`, and expand phonetic trigger aliases (`juno` -> `june`, `you know`, `junior`); (4) **They-Pay-Us Flip** — charge external meeting-agent vendors `$499` for a Managed PreToolUse Meeting-Firewall Diagnostic or `$19/mo` Pro.

## Google / Dave Rensin Elephant-Goldfish Model (`egm.dev`) & Leave-Work-at-Work Family Sanctuary honesty (FORMAT steal)

Steal the 4 Spec-Driven Development & Autonomous Verification rails from Dave Rensin's **Elephant-Goldfish Model** (`https://egm.dev` / `https://github.com/google/elephant-goldfish-model` / `drensin.medium.com`) coupled with the **Leave-Work-at-Work Family Sanctuary Mandate** (`https://www.jw.org/finder?wtlocale=E&docid=500300102` — Matthew 19:6, Proverbs 11:2, Ecclesiastes 3:1, Philippians 1:10) onto `scripts/rrsi-doctor.js` (`evaluateElephantGoldfishAutonomousSanctuaryLoop`) at `$0` spend (do not install external `egm` plugins): (1) **Leave Work at Work (Zero-Babysitting Sanctuary)** — once Igor states a goal, maximize `lookAwayDurationHours` with `humanInterruptionsCount === 0` so Igor can unplug and be 100% present with his wife; (2) **Grow & Teach the Elephant (`sizeof(docs) << sizeof(code)`)** — enforce the No-Code-Before-Spec rule, the Sycophant Challenge (ban flattery/apologies, lead with critique), and the iterative 4-section spec (`Problem`, `Technical Plan`, `Alternatives Rejected`, `Detailed Implementation` with every file enumerated); (3) **Zero-Context Goldfish Swarm (Serialization Test)** — spawn amnesiac subagents (`Comprehension`, `Adversarial Critic` looping until nits, `Implementation Readiness`, and `Mean Code Review` "tear it to shreds") before ever claiming completion; (4) **Peanuts & Hay Recursive Summarization + Drift Scanner** — build leaf-to-root component (`Peanuts`) and repository (`Hay`) blueprints synced between `<repo>/obsidian/` and `~/Documents/AI-Agent-Sync/Projects/<Project>/`.

## Poolside Laguna 2.1, DFlash Speculative Decoding & Anti-Reward-Hacking honesty (FORMAT steal)

Steal the 4 Poolside `Laguna S 2.1` (118B/8B-active, 1M ctx) and `Laguna XS 2.1` (33B/3B-active, 256K ctx) execution rails onto `adapters/poolside/` and `scripts/rrsi-doctor.js` (`evaluatePoolsideLagunaDflashAndAntiRewardHackingGate` / `--poolside-laguna`): (1) pair base MoE weights with precision-matched `DFlash` 1B 6-layer speculators (`Laguna-*-2.1-DFlash`) for 2× throughput, forcing `--moe-backend triton --num-speculative-tokens 7 --tool-call-parser poolside_v1` on `vLLM >= 0.22.0` (avoiding the DeepGEMM DFlash conflict) and `poolside/Laguna-XS-2.1-NVFP4-mlx` / `llama.cpp` `laguna` branch (`--spec-draft-n-max 15`) on Apple Silicon; (2) route `auto_mode_classifier` to `poolside/laguna-xs-2.1` and delegate single-file diffs/tests across Dual ACP subagents (`fast_test_diff`, `security_auditor`); (3) toggle `enable_thinking: true` in `/plan` mode and `enable_thinking: false` in `/agent-mode build` to halve latency while preserving 1M context, wiring deterministic profilers (`scripts/perf-budget-check.js`) before optimization; (4) block RL benchmark/reward-hacking (`git log --all --grep *`, `git reflog *`) in `tools.shell.deny` and pair fail-open `hooks` with native permissions + Zero-Data-Retention.

## DreamLabs Dream-1 World Action Model & 5-Minute Embodiment FaaS honesty (FORMAT steal)

Steal the 4 architectural and unit-economics rails from DreamLabs' **Dream-1** (`https://dreamlabs.ai/research/dream-1/`) onto `scripts/rrsi-doctor.js` (`evaluateDream1WorldActionAndEmbodimentFaaSGate` / `--dream-1`) at `$0` outbound spend: (1) **Joint Consequence-Action Denoising** — predict imagined post-action state frames and the `1.6s` action chunk (`2,250 calls/hr`) together in one pass, replacing the imagined frame with the verified real observation frame before the next chunk; (2) **Canonical End-Effector (`EEF`) Action Space + Local Inverse Kinematics (`IK`) Safety Diode** — generalize zero-shot across 27+ simulated and 21+ real robot/agent embodiments while blocking lethal/unsafe grasps (`knife_blade` vs `knife_handle`); (3) **5-Minute One-Shot Embodiment FaaS** — adapt zero-shot policies on 5–98 minutes of failure/correction rollouts; (4) **FDE Unit-Economics Flywheel** — anchor ThumbGate's `$0.0000/action` (`<0.5ms` local CPU) diode against `$3/hr` (`$0.0013/action` Dream-1) and `$2/hr` (`$0.0009/action` Dream-1-flash) so Forward-Deployed Engineers keep 100% of margin above runtime cost (`$19/mo` Pro, `$100` Founding Tier, `$499` FDE Diagnostic).

## GitHub Native Stacked PRs (`gh stack`) & Async Merge Queue honesty (FORMAT steal)

Steal the 4 stacked-PR engineering rails from *How stacked PRs work behind the scenes at GitHub* (`https://www.youtube.com/watch?v=sbHoDdAalMI` — S02E05) onto `scripts/pr-manager.js` (`evaluateStackedPrGovernance`), `scripts/rrsi-doctor.js` (`evaluateGitHubNativeStackedPrPipeline` / `--github-stacked-prs`), and `.agents/skills/github-stacked-prs/SKILL.md`: (1) decompose features in Plan Mode into atomic slices aligned with a single `CODEOWNERS` group per PR (`schema -> API/engine -> UI/docs`); (2) **Block Mid-Stack `CODEOWNERS` Edits** — GitHub evaluates `CODEOWNERS` strictly against `main` to prevent chain security bypasses, so mid-stack `CODEOWNERS` changes are ignored by upper PRs and must land on `main` first; (3) use **Asynchronous Merge / Queue APIs** (`/trunk merge` / `gh stack merge`) to avoid 10-second legacy synchronous merge timeouts on multi-PR stacks; (4) unwind intermediate-branch CI trigger hacks (native stacks inherit `main` protection), preserve GitHub-signed commits on stack rebases, and block cross-fork stacking.

## OpenAI / AAIF `Open Responses` Specification & Tri-Protocol Transducer honesty (FORMAT steal)

Steal the 4 interoperability and state-machine rails from OpenAI's donation of **Open Responses** to the Linux Foundation's **Agentic AI Foundation (AAIF)** (`https://thenewstack.io/openai-donates-open-responses/` & `https://www.openresponses.org/specification`) onto `scripts/rrsi-doctor.js` (`evaluateOpenResponsesAaifInteroperabilityAndGovernanceGate` / `--open-responses`): (1) validate polymorphic `Items` across `in_progress -> completed | incomplete` (an `incomplete` item must be the final item emitted and set the parent response to `incomplete`); (2) enforce SSE `event === data.type` without SSE `id`; (3) enforce WebSocket `/v1/responses` single in-flight execution (no multiplexing or HTTP `stream`/`background` fields), evict `previous_response_id` on `4xx`/`5xx` when `store: false` (`previous_response_not_found`), and reset `previous_response_id: null` after standalone `/responses/compact` or 60-minute `websocket_connection_limit_reached`; (4) bridge the 3-way API split across `Open Responses` (OpenAI, Bedrock, Databricks, Vercel, vLLM), Anthropic `Messages API` (Anthropic, DeepSeek, Moonshot, Z.ai, MiniMax), and Google `Interactions API`, plus govern all 4 new AAIF projects (`Open Responses`, `Agent Skills`, `OpenEnv`, `OpenSandbox`).

## Vercel Labs Zig `fx` Embedded Coding Agent honesty (FORMAT steal)

Steal the 3 composable-agent rails from Vercel Labs' Zig `fx` agent (`https://www.infoq.com/news/2026/10/vercel-zig-fx-agent/`) onto `scripts/rrsi-doctor.js` (`evaluateVercelZigFxEmbeddedAgentHonestyGate` / `--vercel-fx`): (1) expose scrollback-native JSON CLI (`--json`), ACP (`acp`), and embeddable engine (`createFxEngine()`) surfaces without forcing a full-screen TUI in CI; (2) block silent first-run Vercel AI Gateway lock-in, guard against the Homebrew `fx` JSON-viewer binary collision (`vercel-labs/fx#197`), and reject unverified vendor `10 µs` cold-start claims without local `scripts/perf-budget-check.js` proof; (3) block pre-`v0.0.13` incompatible `libfx` checkpoint restores and deprecated `createFxAgent()` calls.

## Ramp `Laminar` Harness & LangChain Open SWE In-Harness Routing honesty (FORMAT steal)

Steal the 3 production harness rails from Ramp's **Laminar** and LangChain's **Open SWE** (`https://thenewstack.io/ramp-laminar-agent-harness/`) onto `scripts/rrsi-doctor.js` (`evaluateRampLaminarHarnessAndSandboxDecouplingGate` / `--ramp-laminar`): (1) **Session-from-Sandbox Decoupling ("Sandbox-as-a-Tool")** — persist conversation/session state outside ephemeral code sandboxes and never place credentials inside the untrusted sandbox (`credentialsInsideSandbox: false`); (2) centralize auth, ACLs, and tool execution in an external Connectors Service with non-blocking async execution by default; (3) route models **inside the harness** (where prompt, tool, and domain context live, unlike a blind LLM gateway), sending $\ge 90\%$ of requests to fast/intermediate tiers to cut median thread cost by **64%** (`$2.61 -> $0.94/thread`) without degrading merged PR rates (`29.2%` vs `27.3%`).

## Tsinghua `AKV` Cache Engineering for Agents (`arXiv:2610.28577`) honesty (FORMAT steal)

Steal the 4 KV-cache engineering rails from *Cache Engineering for Agents* (`https://arxiv.org/abs/2610.28577` / `thu-nics/AKV`) onto `scripts/rrsi-doctor.js` (`evaluateAkvCacheEngineeringAndRollingDropGate` / `--akv-cache`): (1) avoid text-level prefix trimming (which triggers `1.85x` suffix re-prefill cost) and abrupt threshold summarization (`-5 pp` accuracy) by controlling active KV cache directly via $\operatorname{append}$, $\operatorname{drop}(P)$, and $\operatorname{repos}$ (RoPE key rotation $K \leftarrow R(q)R(p)^{-1}K$) using the operate-after grammar (`drop` before `repos` at the same boundary); (2) **Drop Tool-Response KV Only ($K=12$ rolling window), Never Assistant Reasoning KV** (`+1.7` benchmark points, `-27.7%` cost, and `-32.8%` with RSI policy refinement); (3) track history-dependent KV states in an **Extended Radix Tree** with drop ($\Delta$) and reposition nodes; (4) restore evicted KV states in a single prefill pass via **Segment-Batch Attention** (`1.18x` output throughput, `1.51x` P95 latency speedup).

## DeepSeek `DeepInfer` V4.1-Flash & YOCO Bounded Replay honesty (FORMAT steal)

Steal the 4 inference-runtime rails from `deepseek-ai/DeepInfer` (`https://github.com/deepseek-ai/DeepInfer`) onto `scripts/rrsi-doctor.js` (`evaluateDeepInferV41FlashRuntimeAndYocoReplayGate` / `--deepinfer-v41`): (1) enforce `DEEPINFER_BATCH_INVARIANT=1`, `DEEPINFER_ENABLE_MTP_VARLEN=0`, and a fixed `seq_seed` on NVIDIA SM100 for deterministic evals (blocking Ascend 950 batch-invariant claims and disabling speculative MTP varlen during deterministic runs); (2) enforce Decoder YOCO / SWA bounded replay (`DEEPINFER_YOCO_PREFILL_TRUNCATION_MODE=compact`, `DEEPINFER_YOCO_PREFILL_KEEP_TOKENS=140 >= swaWindow + maxBacktracking`); (3) schedule DSpark draft verification (`nextn=5`) by confidence and constrain tool outputs via `so_args` (`regex` | `json_schema` | `ebnf`); (4) pair the offline `DeepInfer` engine with an external KV cache system (`AKV`), `4:64` Prefill/Decode disaggregation, and `EPLB`.

## Erik Bernhardsson (Modal) Rectangular Compute, Snapshot Branching & Escape-the-Room honesty (FORMAT steal)

Steal the 4 agent-infrastructure rails from Modal's Erik Bernhardsson (*Why AI Compute Comes in Rectangles*) onto `scripts/rrsi-doctor.js` (`evaluateModalRectangularComputeAndSnapshotSandboxGate` / `--modal-rectangles`): (1) run durable workflows outside ephemeral command sandboxes and use memory/filesystem **Snapshot Cloning** to branch agents into parallel sandboxes and run 1-test-per-sandbox CI shards; (2) lock down default sandbox network egress and run defensive **"Escape the Room"** red-team agents inside sandboxes to catch container escapes pre-release; (3) favor imperative SDKs over static YAML DSLs, audit docs/errors/pricing for **Agent Engine Optimization (AEO)**, and avoid breaking API deprecations (or update all skills/examples simultaneously); (4) benchmark off-the-shelf open weights (`Kimi K3`, `DeepSeek-V4.1-Flash`, `Laguna 2.1`, `GLM`) before custom SFT, mix hardware via disaggregated prefill/decode, and rent bursty compute instead of signing 3-year rectangular GPU leases.

## NVIDIA `flare-local-inference` (`Ignition` + `Helios`) Reasoning, Sampling & Usage honesty (FORMAT steal)

Steal the 4 local-inference protocol rails from `NVIDIA/flare-local-inference` (`https://github.com/NVIDIA/flare-local-inference/blob/main/docs/api.md#reasoning-sampling-and-usage`) onto `scripts/rrsi-doctor.js` (`evaluateNvidiaFlareLocalInferenceAndReasoningSamplingGate` / `--flare-local`): (1) clamp numeric sampling parameters to each recipe's packaged `{min, max}` interval (`qwen38`, `glm53`, `deepseek41`, `kimi3`, `step5`, `nemotron_h`) with strictly positive temperature bounds; (2) enforce `DeepSeek-V4.1` strict integer `reasoning_effort` (`1..100`, rejecting floats/strings/booleans, `drop_thinking`, and `add_generation_prompt=false`) and validate local `flare-thinking-v1:` markers without fabricating hosted signatures; (3) enable `"stream_options": {"include_usage": true, "continuous_usage_stats": true}` so cancelled streams still report accurate cumulative native token counts alongside `cached_tokens`; (4) score 1–64 `/v1/systemone` and `/v1/decisions` questions in 1 token per question via FP32 `logprob_token_ids` (up to 128 explicit IDs + sampled token = 129).

## AA Personality Bench 8-Index Routing & DHS Federal Supply-Chain Compliance honesty (FORMAT steal)

Steal the 3 model-selection and compliance rails from *Why AI Companies Are Betting Personality Beats Intelligence* (`https://www.youtube.com/watch?v=FSX5JFJS9PQ`) onto `scripts/rrsi-doctor.js` (`evaluatePersonalityBenchRoutingAndFederalSupplyChainGate` / `--personality-bench`): (1) route tasks using the 8 **AA Personality Bench** indices (*Expressiveness, Organization, Informativeness, Transparency, Warmth, Conviction, Imagination, Slop*) — routing strategic brainstorming to high-*Imagination* (`Opus 5.5`), analytical pushback to high-*Conviction* / low-sycophancy, creative writing to high-*Expressiveness* (`Fable 5.1` / `GLM 5.3`), and concise executive/compliance work away from high-*Slop* models; (2) expose transparent human-readable reasoning traces rather than opaque black-box execution (ChatGPT Dots anti-pattern); (3) enforce the **DHS Federal & Defense Supply-Chain Ban** by blocking `deepseek*` models/fine-tunes (even on US hyperscalers) and requiring FBI/internal security vetting on federal/defense workloads.

## Trevillion & Muller (Ep 97) Agent Control, Anti-"Token Maxing" & Anti-Data-Pollution honesty (FORMAT steal)

Steal the 3 enterprise governance rails from Todd Trevillion & Paul Muller (*Ep 97 | AI Agents Move Fast. Who's in Control?*) onto `scripts/rrsi-doctor.js` (`evaluateTrevillionMullerAgentControlAndAntiTokenMaxingGate` / `--agent-control-ep97`): (1) audit/remediate messy data before agent deployment, enforce centralized observability/data sovereignty, and document all "vibe-coded" integrations to eliminate single-employee bus-factor risk; (2) rank use cases by outcome ROI with board-level inference-cost forecasts and route routine tasks to SLMs to stop **"Token Maxing"** on frontier models; (3) require AI Steering Committee sign-off or a Small-Team Governance Checklist, verify commercial IP ownership on AI-generated code, and keep human-in-the-loop blast-radius controls blocking unchecked self-source modification and core-system **"data pollution"** (phony invoices / hallucinated orders).

## Caleb Sima & Ashish Rajan AI Security SWAT Team & Swarm Deception honesty (FORMAT steal)

Steal the 4 machine-speed defense rails from *How to Build an AI Security SWAT Team* (`https://www.youtube.com/watch?v=PmvwgDxaFSc`) onto `scripts/rrsi-doctor.js` (`evaluateSimaRajanAiSecuritySwatAndSwarmDefenseGate` / `--security-swat`): (1) automate Tier 0–3 least-privilege audits, enforce dynamic JIT privilege provisioning on build/prod, and replace static credentials with short-term ephemeral tokens + org-wide MFA (closing the 90% breach vector); (2) aggregate SOC, CloudSec, AppSec, and supply-chain signals into a unified telemetry harness, deploy **Deception Honeypots** ("crowd control") to loop and stall attacking agent swarms, and monitor internal agent reasoning for goal drift; (3) run uncensored open-weight models on internal compute to continuously fuzz binaries and codebases for zero-defect releases; (4) structure security as a **Barbell SWAT Team** (zero middle management, 6–7 principal AI-forward ICs paired with junior engineers, 12–15 total headcount).

## Viral 8-Step Carousel & Lead-Magnet Monetizer honesty (FORMAT steal)

Steal the 8-step Claude Code carousel workflow (`https://www.youtube.com/watch?v=dKUgGN4Q_Hs`) onto `scripts/fast-money-engine.js` (`--carousel`), `scripts/rrsi-doctor.js` (`evaluateViralCarouselLeadMagnetAndSelfQaGate` / `--viral-carousel`), and `.agents/skills/viral-carousel-monetizer/SKILL.md` at `$0` outbound spend (never buy paid Blotato subscriptions): (1) rank past posts by saves and shares and format top performers as list-style carousels; (2) build and `HTTP 200`-verify the lead-magnet & 4-tier checkout ladder (`$9.99` Playbook / `$49` Bundle / `$100` One-Time Pass / `$499` Diagnostic) before publishing; (3) engineer the Hook Slide with brand mark, tool logo, prop-free scene, and video-title power-word headline; (4) include 2 same-day verified stat boxes per body slide (omitting unverified stats), run automated visual Self-QA (`overlappingElementsCount === 0`), generate distinct per-account variations, adapt the LinkedIn final slide to point to the caption link (`>= 2h` spacing), require human approval, and append every revision note into `SKILL.md`.

## Thesys `OpenUI` (`thesysdev/openui`) Streaming OpenUI Lang & Catalog Honesty (FORMAT steal)

Steal the 4 generative-UI token-efficiency rails from `thesysdev/openui` (`https://github.com/thesysdev/openui` — 14.1k stars, MIT) onto `scripts/fast-money-engine.js` (`--openui-stream`) and `scripts/rrsi-doctor.js` (`evaluateThesysOpenUiLangAndCatalogStreamGate` / `--thesys-openui`): (1) stream root-first `OpenUI Lang` (`root = Stack([...])`) to cut UI token usage by **52.8% overall** (`4,800` vs `10,180` tokens, up to **-67.1% on forms**, `4.9s` vs `14.2s` latency @ 60 tok/s compared to Vercel `json-render` and Google `A2UI`); (2) restrict output strictly to a Zod-typed allowlisted component catalog (`unknownComponentsCount === 0`, no `eval`/`new Function`); (3) require `--repair --claim-ready` validation before claiming valid UI; (4) enforce `OPENUI_TELEMETRY_DISABLED=1` (never ship events to `@openuidev/observability-cloud` or `OpenUI Gateway`) and never claim `thesysdev/OUI-1` (`52GB` bf16 CUDA `vLLM >= 0.24` diffusion sampler) runs locally on Apple Silicon MLX.

## MrBeast CPTO Multi-Variant Exploration & Institutional Memory Layer honesty (FORMAT steal)

Steal the 3 product-velocity and memory rails from MrBeast's CPTO (`https://www.youtube.com/watch?v=DgX3XqhIhas`) onto `scripts/rrsi-doctor.js` (`evaluateMrBeastMultiVariantAndInstitutionalMemoryGate` / `--mrbeast-cpto`): (1) **Multi-Variant Exploration to Fix Product Blind Spots** — build $\ge 3$ functional variants simultaneously (the primary vision plus $\ge 2$ user-data-tailored variants, such as our `$19/mo` Pro Direct + `$49` One-Time Corporate-Expense Kit + `$100` One-Time Pass on `thumbgate.ai`) and test all three; (2) **Proactive Institutional Memory Layer** — unify fragmented pipelines, force-capture operational lessons from ground execution, and automatically surface historical pitfalls (*"Last time we built X, these 3 things went wrong"*) with an upvote/downvote scope-refinement loop (global vs localized); (3) **Software-Release Discipline & Pocket Monetization** — enforce pre-launch reviews, post-launch analytical retros, and localized pocket monetization tests before global rollout.

## Pancake.ai GTM Brain, Signal-Triggered Plays & Agent-Executable `install.md` honesty (FORMAT steal)

Steal the 3 GTM-automation and agent-onboarding rails from Pancake (`https://pancake.ai/` & `https://pancake.ai/install.md`) onto `public/install.md`, `scripts/fast-money-engine.js`, and `scripts/rrsi-doctor.js` (`evaluatePancakeGtmBrainPlayAndInstallMdGate` / `--pancake-gtm`) at `$0` outbound spend (never buy `$99/mo` external GTM workspaces): (1) expose a 1-line copy-paste agent onboarding spec at `https://thumbgate.ai/install.md` with OAuth Client ID Metadata Document (`CIMD`) support (`/.well-known/mcp/server-card.json`) and **Read-Before-Claim Verification** (never claim `"connected and verified"` from a saved config file alone; require an authenticated read-only tool call first); (2) structure outbound into continuous signal-triggered **Plays** (`Who + Signal + Pace + Why they fit`) backed by a domain-derived **GTM Brain**; (3) enforce human approval per lead batch before outreach, auto-send calendar/checkout links on `"Yes"` replies, and feed weekly reply-rate analytics (`+56%` reply rate learnings) back into the GTM Brain.

## LangChain / Harrison Chase Multiplayer Company Harness & Identity Matrix honesty (FORMAT steal)

Steal the 5 multiplayer company-harness primitives from Harrison Chase's LangChain internal agents breakdown (`https://x.com/hwchase17/status/2114041443836903662` — `GTM Agent`, `OpenSWE`, `Content Studio`) onto `scripts/rrsi-doctor.js` (`evaluateLangChainCompanyHarnessAndIdentityMatrixGate` / `--company-harness`): (1) **Shared-Channel Thread Breakout + Custom Backlog UI** — break out into a dedicated thread when tagged in a shared channel so agent runs never pollute human conversations, and route large review backlogs (`> 5` items) to a custom UI instead of chat message walls; (2) **Per-Tool Identity & Channel-Scope Matrix (`OBO` vs Fixed Service Account)** — execute interactive user requests (`OpenSWE` PR creation, `Content Studio` Notion edits) On-Behalf-Of (`OBO`) the invoking user, execute background/shared-CRM tasks (`OpenSWE` PR reviews, Salesforce reads) with a fixed app/service identity, **strictly forbid personal OBO email tools in shared channels (`DM` only)**, and restrict fixed-credential company social publishing (`Content Studio` Twitter/X) to a whitelisted user ACL; (3) **Dual-Tier Scoped Memory (`global` vs `user`)**; (4) **Secret-Proxy Sandbox** (harness runs outside the sandbox, selects base images by channel/user, and proxies authenticated requests so raw credentials never enter the sandbox); (5) **Ambient Scheduled Runs** combining developer-wired event triggers (`PR opened -> review`) with user-requested self-created crons (`daily brief`).

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

## `rtk-ai/icm` Zero-LLM RRF Recall, Access-Damped Decay & PreToolUse Firewall Advantage (FORMAT Steal)

Steal the 5 local-SQLite memory primitives from `rtk-ai/icm` (`https://github.com/rtk-ai/icm`) into `scripts/rrsi-doctor.js` (`evaluateRtkIcmZeroLlmMemoryAndRrfRecallGate` / `--rtk-icm`) while preserving ThumbGate's active `PreToolUse` enforcement moat: (1) **Zero-LLM Store & 3-Arm Reciprocal Rank Fusion (`rrf_fuse`, $k = 60$):** fuse lexical FTS5 BM25, cosine vector KNN, and query-parsed temporal windows by rank ($1/(60 + \text{rank})$) with `0` LLM calls on the hot path, running `UserPromptSubmit` in read-only keyword+temporal mode (`6.8ms` median) and bounding `SessionStart` wake-up packs to $\le 500$ tokens; (2) **Importance-Tiered Access-Damped Decay & In-Topic Auto-Merge:** apply $\text{rate} = (\text{base} \times m)/(1 + 0.1 \times \text{access\_count})$ where `Critical` prevention rules have $m = 0.0$ (never decay or prune), and auto-merge new memories with $>0.85$ hybrid / $>0.95$ cosine similarity in the same topic; (3) **Byte-Offset Transcript Watermarking & `-40%` Compact Tabular Recall:** track `last_byte_offset` on `PreCompact`/`SessionEnd` so only newly appended turns are distilled (dated at capture time), emit compact tabular recall rows (`-40%` tokens), and nudge after `10` consecutive tool calls without capture; and (4) **Active `PreToolUse` Firewall Over Passive Recall:** unlike `icm hook pre` (which passively auto-allows CLI calls and cannot stop an agent from repeating a mistake), ThumbGate compiles negative feedback and `Critical` memories into deterministic `<0.1ms` `PreToolUse` blocks and DPO pairs. Never vendor the Rust `icm` binary or `Qdrant/multilingual-e5-large-onnx` (2GB).

## Warp AI-Native Task Parity, Statutory Sign-Off & DeepMind External Stochasticity Honesty (FORMAT Steal)

Steal the AI-native product and stochasticity invariants from Ayush Sharma (Warp CEO on YC Root Access) and Google DeepMind via Rohan Paul (`https://x.com/rohanpaul_ai/status/2114083454564585720`) into `scripts/rrsi-doctor.js` (`evaluateWarpAiNativeTaskParityAndExternalStochasticityGate` / `--warp-ai-native`): (1) **100% Agent-Executable Task Parity:** architect every deep compliance, billing, and governance workflow so `100%` of tasks can be performed end-to-end by an agent via CLI/MCP (`agentExecutableTaskParityPct === 100`); (2) **Statutory & Financial Sign-Off Gate:** while agents execute `100%` of compliance preparation, verification, and pre-flight audits autonomously, statutory filings and irreversible financial commitments require an explicit cryptographic human sign-off gate (`requiresHumanSignoffForStatutoryOrFinancialCommit === true`); and (3) **External Code Stochasticity ("The Illusion of Stochasticity in LLMs"):** never ask an LLM to generate random numbers, jitter, or exploration choices inside the prompt (where models mode-collapse to favorite tokens); always generate randomness and Thompson Sampling in deterministic host code (`crypto.randomBytes`) and inject the sampled state into the harness.

## Lehmann & Vahdati ARC-AGI-3 Self-Improving Harness & Adaptation Gap Honesty (`arXiv:2610.30499`, FORMAT Steal)

Steal the 4 empirical harness-evolution guardrails from Jens Lehmann & Sahar Vahdati's *"Can LLMs Improve Their Own Harness? A Controlled Study on ARC-AGI-3"* (`arXiv:2610.30499`, 27 lineages, 81 frozen snapshots, 2,025 game evaluations) into `scripts/rrsi-doctor.js` (`evaluateArcAgi3SelfImprovingHarnessAndAdaptationGapGate` / `--arc-agi-3-harness`): (1) **Harness Adaptation Gap ($G_t$) Gate:** compute $G_t = [J_{\mathcal{D}_{\text{dev}}}(H_t) - J_{\mathcal{D}_{\text{dev}}}(H_0)] - [J_{\mathcal{D}_{\text{test}}}(H_t) - J_{\mathcal{D}_{\text{test}}}(H_0)]$ and block revisions whose development gains overfit ($G_t > 5.62$ RHAE) without transferring to feedback-held-out tasks; (2) **Joint 3-Tuple Resource-Rational Evaluation & "Cheaper/RHAE$\downarrow$" Trap Block:** evaluate $(J_{\mathcal{D}_{\text{test}}}(H_t), -C_{\text{run}}(H_t), -C_{\text{outer}}(H_{0:t}))$ jointly and reject cost-contraction revisions (`9/27` lineages) that cut per-run inference cost ($C_{\text{run}}\downarrow$) by stripping response chaining or memory at the expense of held-out performance ($J_{\text{test}}\downarrow$); (3) **Abstention & Preserved-Parent Checkpoint Selection:** because `0/54` LLM revisions abstained voluntarily (`12/27` held-out regressions), preserve all parent snapshots $\{H_0, H_1, H_2\}$ and select by validation utility with ties broken toward the earlier snapshot $H_0$ (`+4.53` vs `+2.80` RHAE, cutting regressions from `12` to `5`); and (4) **Fixed-Harness Execution Variance ($\sigma = 3.99$) & Unfaithful CoT Triangulation:** require held-out gains without cost reduction to exceed the fixed-harness execution noise floor ($\sigma = 3.99$), and triangulate updater narration ($\kappa = 0.29\text{--}0.35$) against actual tool calls, code diffs, and runtime traces.

## CNCF `in-toto/witness` DSSE Supply-Chain Attestation, Key Separation & `~/Downloads` Quarantine (FORMAT Steal)

Steal the supply-chain attestation architecture from CNCF `in-toto/witness` (`https://github.com/in-toto/witness` / Help Net Security Oct 26, 2026) into `scripts/rrsi-doctor.js` (`evaluateWitnessSupplyChainDsseAndDownloadsQuarantineGate` / `--witness-dsse`) while adding ThumbGate's pre-execution blocking moat: (1) **3-Collection DSSE Command Wrapper (`Materials -> CommandRun -> Products`) & SLSA v1.0:** record pre-execution SHA-256 `materials`, execution trace `commandrun`, and post-execution `products` inside a signed DSSE envelope (`https://witness.testifysec.com/policy/v0.1`) with SLSA Level 1 provenance; (2) **OPA/Rego Policy & Strict Functionary $\neq$ Policy-Owner Key Separation:** never sign the policy with the same key (`testkey.pem`) that signs build/agent step attestations (`functionaryKeyId !== policySignerKeyId`), preventing a compromised runner from forging both evidence and policy; (3) **Untrusted `~/Downloads/**` Prompt-Injection Quarantine:** treat files in `~/Downloads/**` as untrusted data-only inputs and block shell/tool execution triggered by unverified `~/Downloads/**` instructions; and (4) **Pre-Execution `PreToolUse` Block Before `CommandRun`:** unlike `witness verify` (which only fails *after* `witness run` has already executed a destructive command), ThumbGate blocks policy-violating tool calls in `<0.05ms` *before* execution.

## Stanford & UC Berkeley `TokenGate` Learned Prefill Token Pruning (`arXiv:2610.26754`, FORMAT Steal)

Steal the 3 end-to-end learnable prefill-pruning invariants from Patel, Ranjan, Stoica, Zaharia & Guestrin's *"TokenGate: Adapting LLMs for Fast and Memory-Efficient Prefill with Learned Token Pruning"* (`arXiv:2610.26754`) into `scripts/rrsi-doctor.js` (`evaluateTokenGateLearnedPrefillPruningAndGatedAttention` / `--tokengate-prefill`): (1) **Protected Request Set $\mathcal{N}$ vs. RMSNorm-Scored Prunable Context $\mathcal{P}$:** partition prompts into $x = [x_R, x_D]$ where request/instruction tokens $x_R \in \mathcal{N}$ have fixed score $b_j := 0$ and are never pruned, while document/context tokens $x_D \in \mathcal{P}$ are scored at gate layer $L$ via RMSNorm-normalized $\text{MLP}_\theta(\tilde{a}_j^L)$ to keep $S = \text{top-}K_{j \in \mathcal{P}}(b_j) \cup \mathcal{N}$ and skip KV-cache allocation for pruned tokens in all layers $\ell > L$ (`1.4x–11.3x` faster TTFT, `1.5x–3.4x` lower peak memory); (2) **Token-Gated Attention with Head-Wise Gain & Log-Rank Temperature Scaling:** make top-$K$ differentiable via $\alpha_{ij}^{\ell h} = \text{softmax}_{j \in S, j \le i}(\tau_i^{\ell h}(q_i^\top k_j/\sqrt{d} + \text{softplus}(\gamma^{\ell h})b_j))$ with log-rank temperature recalibration $\tau_i^{\ell h} = \text{softplus}(\sigma^{\ell h})\frac{\log m_i}{\log \max(2, p_i)}$; and (3) **Dual-Budget Log-Uniform Co-Adaptation & Hybrid-Attention Support:** train with $\mathcal{L} = \frac{1}{2}(\mathcal{L}_{K_{\text{full}}} + \mathcal{L}_{K_{\text{prune}}})$ where $K_{\text{prune}} \sim \text{LogUniform}(1, |\mathcal{P}|/2)$ across both full-attention and Gated-DeltaNet layers. Never vendor the external `tokengate-models/TokenGate` PyTorch repository.

## AgentField `SWE-AF` 3-Loop Hierarchical Factory, Explicit Debt Propagation & DID/VC Chain (FORMAT Steal)

Steal the 4 multi-agent software-factory invariants from `Agent-Field/SWE-AF` (`https://github.com/Agent-Field/SWE-AF`) into `scripts/rrsi-doctor.js` (`evaluateSweAfHierarchicalFactoryAndDebtPropagationGate` / `--swe-af-factory`): (1) **3-Loop Hierarchical Escalation & Risk-Proportional QA Routing:** route issues via `needs_deeper_qa` between the 2-call Default Inner Loop (`Coder -> Reviewer`) and 4-call Flagged Inner Loop (`Coder -> parallel QA + Reviewer -> QA Synthesizer`), escalating exhausted issues to the 5-action Middle Loop (`Issue Advisor`: `RETRY_MODIFIED`, `RETRY_APPROACH`, `SPLIT`, `ACCEPT_WITH_DEBT`, `ESCALATE_TO_REPLAN`) and 4-action Outer Loop (`Replanner`: `CONTINUE`, `MODIFY_DAG`, `REDUCE_SCOPE`, `ABORT`, with orchestrator crash fallback defaulting to `CONTINUE`); (2) **Kahn Topological Level Barriers & Semantic Worktree Merger:** execute independent issues per dependency level in isolated git worktrees behind a 10-gate level barrier (`Merge -> Integration Test -> Debt -> Split -> Replan -> Checkpoint`); (3) **Explicit Incompleteness (`accumulated_debt`) Propagation:** never silently drop relaxed acceptance criteria—record typed, severity-rated debt items and propagate `debt_notes` and `failure_notes` to dependent issues and the PR body; and (4) **5-Key Synchronous Cross-Issue Memory & Linked Workflow VC Chain:** propagate `codebase_conventions`, `failure_patterns`, `bug_patterns`, `interfaces/{issue}`, and `build_health` across issues while signing a linked BIP-44 DID Verifiable Credential (`VC`) chain for every agent invocation. Never vendor the external `agentfield` control plane.

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
- [Pattern AI Labs AgentCall Meeting-Agent Voice Firewall & Atomic Canvas honesty](#pattern-ai-labs-agentcall-meeting-agent-voice-firewall-&-atomic-canvas-honesty-format-steal)
- [Google / Dave Rensin Elephant-Goldfish Model (`egm.dev`) & Leave-Work-at-Work Family Sanctuary honesty](#google-/-dave-rensin-elephant-goldfish-model-egm.dev-&-leave-work-at-work-family-sanctuary-honesty-format-steal)
- [Poolside Laguna 2.1, DFlash Speculative Decoding & Anti-Reward-Hacking honesty](#poolside-laguna-2.1,-dflash-speculative-decoding-&-anti-reward-hacking-honesty-format-steal)
- [DreamLabs Dream-1 World Action Model & 5-Minute Embodiment FaaS honesty](#dreamlabs-dream-1-world-action-model-&-5-minute-embodiment-faas-honesty-format-steal)
- [GitHub Native Stacked PRs (`gh stack`) & Async Merge Queue honesty](#github-native-stacked-prs-gh-stack-&-async-merge-queue-honesty-format-steal)
- [OpenAI / AAIF `Open Responses` Specification & Tri-Protocol Transducer honesty](#openai-/-aaif-open-responses-specification-&-tri-protocol-transducer-honesty-format-steal)
- [Vercel Labs Zig `fx` Embedded Coding Agent honesty](#vercel-labs-zig-fx-embedded-coding-agent-honesty-format-steal)
- [Ramp `Laminar` Harness & LangChain Open SWE In-Harness Routing honesty](#ramp-laminar-harness-&-langchain-open-swe-in-harness-routing-honesty-format-steal)
- [Tsinghua `AKV` Cache Engineering for Agents (`arXiv:2610.28577`) honesty](#tsinghua-akv-cache-engineering-for-agents-arxiv:2610.28577-honesty-format-steal)
- [DeepSeek `DeepInfer` V4.1-Flash & YOCO Bounded Replay honesty](#deepseek-deepinfer-v4.1-flash-&-yoco-bounded-replay-honesty-format-steal)
- [Erik Bernhardsson (Modal) Rectangular Compute, Snapshot Branching & Escape-the-Room honesty](#erik-bernhardsson-modal-rectangular-compute,-snapshot-branching-&-escape-the-room-honesty-format-steal)
- [NVIDIA `flare-local-inference` (`Ignition` + `Helios`) Reasoning, Sampling & Usage honesty](#nvidia-flare-local-inference-ignition-+-helios-reasoning,-sampling-&-usage-honesty-format-steal)
- [AA Personality Bench 8-Index Routing & DHS Federal Supply-Chain Compliance honesty](#aa-personality-bench-8-index-routing-&-dhs-federal-supply-chain-compliance-honesty-format-steal)
- [Viral 8-Step Carousel & Lead-Magnet Monetizer honesty](#viral-8-step-carousel-&-lead-magnet-monetizer-honesty-format-steal)
- [Thesys `OpenUI` (`thesysdev/openui`) Streaming OpenUI Lang & Catalog Honesty](#thesys-openui-thesysdev/openui-streaming-openui-lang-&-catalog-honesty-format-steal)
- [Trevillion & Muller (Ep 97) Agent Control, Anti-"Token Maxing" & Anti-Data-Pollution honesty](#trevillion-&-muller-ep-97-agent-control,-anti-token-maxing-&-anti-data-pollution-honesty-format-steal)
- [MrBeast CPTO Multi-Variant Exploration & Institutional Memory Layer honesty](#mrbeast-cpto-multi-variant-exploration-&-institutional-memory-layer-honesty-format-steal)
- [Pancake.ai GTM Brain, Signal-Triggered Plays & Agent-Executable `install.md` honesty](#pancake.ai-gtm-brain,-signal-triggered-plays-&-agent-executable-install.md-honesty-format-steal)
- [LangChain / Harrison Chase Multiplayer Company Harness & Identity Matrix honesty](#langchain-/-harrison-chase-multiplayer-company-harness-&-identity-matrix-honesty-format-steal)
- [`rtk-ai/icm` Zero-LLM RRF Recall, Access-Damped Decay & PreToolUse Firewall Advantage](#rtk-ai/icm-zero-llm-rrf-recall,-access-damped-decay-&-pretooluse-firewall-advantage-format-steal)
- [Warp AI-Native Task Parity, Statutory Sign-Off & DeepMind External Stochasticity Honesty](#warp-ai-native-task-parity,-statutory-sign-off-&-deepmind-external-stochasticity-honesty-format-steal)
- [Lehmann & Vahdati ARC-AGI-3 Self-Improving Harness & Adaptation Gap Honesty (`arXiv:2610.30499`)](#lehmann-&-vahdati-arc-agi-3-self-improving-harness-&-adaptation-gap-honesty-arxiv:2610.30499,-format-steal)
- [CNCF `in-toto/witness` DSSE Supply-Chain Attestation, Key Separation & `~/Downloads` Quarantine](#cncf-in-toto/witness-dsse-supply-chain-attestation,-key-separation-&-~/downloads-quarantine-format-steal)
- [Stanford & UC Berkeley `TokenGate` Learned Prefill Token Pruning (`arXiv:2610.26754`)](#stanford-&-uc-berkeley-tokengate-learned-prefill-token-pruning-arxiv:2610.26754,-format-steal)
- [AgentField `SWE-AF` 3-Loop Hierarchical Factory, Explicit Debt Propagation & DID/VC Chain](#agentfield-swe-af-3-loop-hierarchical-factory,-explicit-debt-propagation-&-did/vc-chain-format-steal)
- [Caleb Sima & Ashish Rajan AI Security SWAT Team & Swarm Deception honesty](#caleb-sima-&-ashish-rajan-ai-security-swat-team-&-swarm-deception-honesty-format-steal)
- [Code search (Graphify-Labs)](#code-search-graphify-labs)
