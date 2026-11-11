# Spec 003: e-means Hadamard-Fisher Variable-Bitrate Embedding Sidecar & Decode Roofline / TCQ Drafter Governance

## 1. Constitution Reference
- `AGENTS.md#Local-Memory-Only`
- `AGENTS.md#Performance-Budgets`
- Primary external research sources adapted (steal-format, zero external cloud/GPU spend):
  - `@shinboson` (`https://x.com/shinboson/status/2120499242342985821`, `2120588249055850540`, `2120573306554204336`): Randomized Hadamard outlier spreading + Fisher-inspired variable-bitrate (`2–4 bits/coord`) codebooks optimized with `e-means` + decode Roofline sweet-spot analysis (`Qwen3.5-4B` `8.41 GB -> 1.23 GB` @ `2.3 bpw`, `91.9%` retention).
  - Swann Bessa et al., *"e-means: outperforming k-means (in one-tenth the epochs)"* (`arXiv:2611.09501`, `https://e-means.github.io/`): Exponential moving average mini-batch centroid updates, scaling-law batch/step auto-tuning ($B = c_B k^{0.13} n^{0.88} T^{0.81}$, $\alpha_0 = \min(0.824 k^{-0.46} B^{0.90} n^{-0.45} T^{-0.11}, 1)$), cosine step decay, proportional-split dead-cluster revival, and exact last-epoch mean finalization.

## 2. EARS Acceptance Criteria
- **WHEN** training subspace or coarse codebooks via `trainEmeans`, **WHILE** given $n$ vectors of dimension $d$ and cluster count $k$ without manual learning-rate tuning, **THE SYSTEM SHALL** compute batch size $B$ and initial step $\alpha_0$ from the `arXiv:2611.09501` scaling laws, apply cosine-decayed convex-hull EMA updates with proportional-split dead-cluster revival, and finalize centroids to exact cluster means.
- **WHEN** `compileEmeansCodebookSidecar` compiles `lesson-embeddings.json` (when corpus size $\ge 16$ and dimension $\ge 12$), **WHILE** preserving inner-product invariance via a deterministic Double Block-Hadamard Butterfly rotation, **THE SYSTEM SHALL** allocate `4.0 / 2.67 / 2.0` bits per coordinate across macro-blocks ranked by empirical Fisher energy, quantize subspace centroids as `Int16` plus `Uint8` Asymmetric Distance Computation (ADC) codes into `lesson-embeddings.emeans.json` (`0o600`), achieve $\ge 6\times$ size reduction vs ASCII float JSON, and retain $\ge 0.95$ `Recall@5` against exact Float64 cosine search.
- **WHEN** `semanticRank` executes in the `PreToolUse` / `retrieve_lessons` hot path without custom dimension truncation, **WHILE** `lesson-embeddings.emeans.json` matches the active provider fingerprint, vector dimension, and exact `(id, sha256(text))` corpus set, **THE SYSTEM SHALL** score candidates directly via ADC lookup tables without parsing `lesson-embeddings.json`, and **SHALL** transparently fall back to `lesson-embeddings.json` (and invalidate/recompile stale sidecars) whenever any lesson hash, count, or provider drifts.
- **WHEN** `evaluateLocalDecodeRooflineAndQuantization` audits a local LLM configuration in `scripts/local-model-profile.js`, **WHILE** accounting for Apple Silicon Metal working-set ceilings (`75%` unified RAM) and hybrid `fullAttentionLayers` (`1/4` linear KV growth on `Qwen3.5` / `Qwen3.8`), **THE SYSTEM SHALL** reject `< 8`-bit KV caches and `< 4.0`-bit primary coding/tool models on $\ge 16\text{ GB}$ hardware (`91.9% < 97%` serious-work floor), **AND SHALL** allow variable-bitrate `e-means` TCQ (`2.0–3.5 bpw`) as a lossless rejection-sampled `speculative_drafter` operating at or below the memory-bandwidth Roofline ridge.

## 3. Explicit Out-of-Scope Boundaries (Non-Goals)
- Do NOT add new files to `package.json:files` or bump `tests/public-bundle-ratchet.test.js` (`0` new bundled files; implement inside existing `scripts/lesson-embedding-index.js`, `scripts/lesson-embedding-maintenance.js`, and `scripts/local-model-profile.js`).
- Do NOT install PyTorch, FAISS, Python C++ extensions, or external GPU dependencies into the Node runtime.
- Do NOT recommend sub-4-bit (`2.3 bpw` / ternary / INT2) models as primary coding or tool-calling models on $\ge 36\text{ GB}$ Apple Silicon Macs (`apple-silicon-llm` standing rule: highest quality that fits hardware).
- Do NOT spend `$ > 0` on external GPU rentals or cloud APIs (`$0` outbound spend invariant).

## 4. Locked Architectural Decisions
- Sidecar path: `<feedbackDir>/lesson-embeddings.emeans.json` (`mode: 0o600`), paired with an in-process `(cachePath, mtimeMs, size)` decoded typed-array cache so warm queries avoid filesystem I/O and JSON parsing completely.
- Fail-closed identity & content-hash check: every requested lesson's `id` and `sha256(lessonText)` must match the sidecar before ADC scoring runs; any mismatch falls back to exact `lesson-embeddings.json`.
- Changeset included at `.changeset/emeans-hadamard-codebook-roofline.md` (`"thumbgate": patch`).

## 5. Worktree-Isolated Atomic Tasks
- `Task 1 (ThumbGate-wt-shinboson-emeans)`: Implement `buildHadamardButterfly`, `trainEmeans`, `compileEmeansCodebookSidecar`, and hot-path ADC `semanticRank` fast-path in `scripts/lesson-embedding-index.js` + maintenance integration in `scripts/lesson-embedding-maintenance.js`.
- `Task 2 (ThumbGate-wt-shinboson-emeans)`: Implement `evaluateLocalDecodeRooflineAndQuantization` + `recommendInferenceBackend` / `buildModelFitReport` wiring in `scripts/local-model-profile.js`.
- `Task 3 (ThumbGate-wt-shinboson-emeans)`: Add unit + hot-path + boundary regression tests in `tests/emeans-hadamard-codebook-and-roofline.test.js`, verify live `~/.thumbgate/lesson-embeddings.emeans.json` compilation & recall on Igor's 463-vector index, and run independent Goldfish verification.

## 6. Adversarial Verification & PCP Contract
- **Mutated State Variables Constrained:** `lesson-embeddings.emeans.json` (`avgBitsPerWeight`, `compressionRatio`, `packedCodesBase64`, `hashes`), `codebookSidecar` drift report, `rooflineRegime`, `verdict`.
- **Verification Suite:** `node --test tests/emeans-hadamard-codebook-and-roofline.test.js tests/lesson-semantic-retrieval.test.js tests/lesson-embedding-maintenance.test.js tests/rag-embedding-identity.test.js tests/public-bundle-ratchet.test.js tests/package-boundary.test.js`.
