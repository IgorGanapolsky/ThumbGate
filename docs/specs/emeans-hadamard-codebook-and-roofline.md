# e-means Hadamard-Fisher Variable-Bitrate Embedding Sidecar & Decode Roofline Governance

> **Spec Status**: Approved  
> **Author**: OMP (`omp-shinboson-emeans-steal`)  
> **Date**: 2026-11-11  
> **Dispatch / Issue Ref**: `https://x.com/shinboson/status/2120499242342985821` · `arXiv:2611.09501`

---

## Problem

1. **Hot-path embedding cache bloat & cold-parse latency:** `~/.thumbgate/lesson-embeddings.json` stores raw ASCII decimal float arrays (`3.72 MB` for `463` `384d` vectors — ~`8 KB` per lesson), requiring `~10.5 ms` of synchronous `JSON.parse` on cold CLI / `PreToolUse` subprocess invocations and scaling linearly toward `~40 MB` at `5,000` lessons.
2. **Local LLM hybrid-attention KV overestimation & sub-4-bit precision traps:** Naive KV formulas budget linear cache growth across all `numLayers` instead of `fullAttentionLayers` (`4x` overestimate on `Qwen3.5` / `Qwen3.8`), and treat sub-4-bit compression (`@shinboson`'s `2.3 bpw` `e-means` TCQ `Qwen3.5-4B` at `1.23 GB`, `91.9%` retention) uniformly instead of distinguishing primary coding models (`>= 4.0 bpw` quality floor on `>= 16 GB` Macs) from lossless rejection-sampled `speculative_drafter` models operating in the compute/dequant-bound Roofline regime.

---

## Technical Plan

1. **Double Block-Hadamard Butterfly (`buildHadamardButterfly` in `scripts/lesson-embedding-index.js`):** Deterministic two-pass normalized Fast Walsh-Hadamard Transform with Rademacher sign flips and cross-block permutation ($Q = H_B D_2 \Pi H_B D_1$). Preserves exact inner products ($\langle Q u, Q v \rangle = \langle u, v \rangle$) while spreading coordinate outliers uniformly prior to quantization.
2. **`e-means` Codebook Optimizer (`trainEmeans` in `scripts/lesson-embedding-index.js`):** Implements Swann Bessa et al. (`arXiv:2611.09501`) scaling-law batch/step auto-tuning ($B = c_B k^{0.13} n^{0.88} T^{0.81}$, $\alpha_0 = \min(0.824 k^{-0.46} B^{0.90} n^{-0.45} T^{-0.11}, 1)$), cosine step annealing, convex-hull EMA updates, proportional-split dead-cluster revival, and exact last-epoch mean finalization.
3. **Fisher Variable-Bitrate ADC Sidecar (`compileEmeansCodebookSidecar` + `semanticRank` fast-path + `lesson-embedding-maintenance.js`):** Ranks rotated `12`-dim macro-blocks by empirical Fisher energy, allocates `4.0 bpw` (`2D` pairs), `2.67 bpw` (`3D` triples), and `2.0 bpw` (`4D` quads) `e-means` codebooks (`~3.21 bpw` average), packs `Int16` codebooks + `Uint8` Asymmetric Distance Computation (ADC) codes into `lesson-embeddings.emeans.json` (`0o600`), caches decoded typed arrays in process memory by `(mtimeMs, size)`, and falls back fail-closed to `lesson-embeddings.json` on any `(id, sha256(text))` or provider drift.
4. **Decode Roofline & TCQ Drafter Gate (`evaluateLocalDecodeRooflineAndQuantization` in `scripts/local-model-profile.js`):** Budgets Apple Silicon Metal `75%` working-set ceilings and hybrid `fullAttentionLayers`, computes single-stream SIMD + TCQ/Hadamard dequantization Roofline regimes (`compute_bound`, `sweet_spot_bandwidth_edge`, `memory_bandwidth_bound`), blocks `< 8`-bit KV caches and `< 4.0 bpw` primary coding/tool models on `>= 16 GB` ceilings, and permits `2.0–3.5 bpw` `e-means` TCQ for lossless `speculative_drafter` workloads.

---

## Alternatives Rejected

| Alternative Considered | Trade-offs / Failure Modes | Reason for Rejection |
|---|---|---|
| Vendor Python `faiss` / PyTorch `e_means` into Node hot path | Adds native C++/Python subprocess startup (`>150 ms`) and breaks zero-dependency `npx thumbgate` installs | Pure JS `Float32Array` `e-means` + ADC runs in `~1 ms` warm / `~0.3 ms` cold load with zero native dependencies |
| Shared single global codebook across all subspaces | Tested empirically on live `463 x 384` corpus: `Recall@5` dropped to `0.928` (`< 0.95` quality floor) | Per-subspace `Int16`-packed `e-means` codebooks achieve `0.968 Recall@5` (`100%` Top-1) at `8.55x` compression |
| Allow `2.3 bpw` TCQ as primary `coding` / `tool_use` model on `>= 36 GB` Macs | `91.9%` retention degrades AST/tool-schema fidelity vs `4-bit` (`~97%`) or `8-bit` (`~100%`) when unified RAM is abundant | Violates `apple-silicon-llm` standing rule; restrict `< 4.0 bpw` TCQ to lossless rejection-sampled `speculative_drafter` or `< 16 GB` non-critical edge |
| Add standalone new script files to `package.json:files` | Inflates the npm bundle file ratchet (`<= 650` files) and risks shelfware modules disconnected from daily paths | Implementing directly inside `lesson-embedding-index.js`, `lesson-embedding-maintenance.js`, and `local-model-profile.js` wires the live hot path with `0` added tarball files |

---

## Enumerated Files

### Created Files
- `.changeset/emeans-hadamard-codebook-roofline.md`
- `docs/specs/emeans-hadamard-codebook-and-roofline.md`
- `specs/003-emeans-hadamard-codebook-and-roofline/spec.md`

### Modified Files
- `scripts/lesson-embedding-index.js`
- `scripts/lesson-embedding-maintenance.js`
- `scripts/local-model-profile.js`

### Test Files
- `tests/emeans-hadamard-codebook-and-roofline.test.js`

---

## Acceptance Checks

- [x] `node --test tests/emeans-hadamard-codebook-and-roofline.test.js tests/spec-template.test.js tests/lesson-semantic-retrieval.test.js tests/lesson-embedding-maintenance.test.js tests/rag-embedding-identity.test.js tests/self-healing-check.test.js tests/public-bundle-ratchet.test.js tests/public-package-boundary.test.js tests/package-boundary.test.js` passes cleanly with zero regressions.
- [x] New unit & hot-path tests cover Hadamard orthogonality, `e-means` convergence, `Recall@5 >= 0.95`, anti-shelfware sidecar execution when `lesson-embeddings.json` is absent, fail-closed hash drift recovery, and Roofline/TCQ governance.
- [x] Changeset added under `.changeset/emeans-hadamard-codebook-roofline.md` (`npm run changeset:check` green).
- [x] Diff is strictly bounded (`<= 1,000` lines).
- [x] No secrets, tokens, or unredacted credentials committed.
