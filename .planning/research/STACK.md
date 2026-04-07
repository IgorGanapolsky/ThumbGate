# Stack Research

**Domain:** ThumbGate Bidirectional Feature Sync — Node.js ML features + React Native governance features
**Researched:** 2026-03-04
**Confidence:** HIGH (verified from live repos, npm registry, and installed packages)

---

## Context: Two-Way Sync

This milestone adds features in two directions:

1. **Into `thumbgate` (Node.js):** Thompson Sampling posteriors, LanceDB vector storage, LSTM sequence features, diversity tracking, RLAIF self-scoring
2. **Into `Subway_RN_Demo` (React Native):** budget guard, intent router, policy bundles, ContextFS, self-healing monitor

The existing stack baseline is:

- `thumbgate` v0.5.0: **zero npm dependencies** — pure CommonJS Node.js >=25 (confirmed: `node v25.6.1`)
- `Subway_RN_Demo` v100.1.0: React Native 0.81.4 + Expo 54 + TypeScript, Python venv at `.claude/scripts/feedback/venv/`

---

## Recommended Stack

### Core Technologies — thumbgate additions

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@lancedb/lancedb` | `0.26.2` (latest stable) | Vector storage for feedback embeddings | Used and tested in Subway's venv at 0.27.1 Python; JS SDK mirrors same API; Node >= 18 required, project is at 25 |
| `@huggingface/transformers` | `3.8.1` (latest stable) | Local ONNX-based embeddings (all-MiniLM-L6-v2) | Only option for local embedding inference in Node.js without Python; replaces Python subprocess call; 22MB model; ~50ms inference |
| `apache-arrow` | `18.1.0` | Arrow table serialization for LanceDB | Required peer dep of @lancedb/lancedb (requires >=15.0.0 <=18.1.0); without it LanceDB will not load |
| Native `Math.random()` + custom Beta | built-in | Thompson Sampling posteriors | No library needed — Beta-Bernoulli TS is 15 lines of pure math using `alpha` and `beta` counts; Subway's `train_from_feedback.py` confirms this; adding a library dependency for a `random.betavariate` equivalent adds zero value |

### Core Technologies — Subway_RN_Demo additions

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Pure JS/CommonJS (copy from thumbgate) | — | budget-guard.js, intent-router.js, contextfs.js, self-healing-check.js, mcp-policy.js | These scripts use zero npm dependencies; they are file-system and `child_process` based; direct copy + Subway path adaptation is the right approach — no new packages required |

### Supporting Libraries — thumbgate

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `onnxruntime-node` | `1.24.2` | ONNX inference backend for @huggingface/transformers | Automatically pulled as a transitive dep of @huggingface/transformers; do not pin separately |
| Python `lancedb` (system) | `0.27.1` (already installed globally) | Python-side vector indexing (Subway venv context only) | Already installed; version is 0.27.1; no action needed for the Subway side |
| Python `sentence-transformers` | `3.0.1` (already installed globally) | Embedding generation for Python scripts | Already installed globally; Subway .claude/scripts/feedback already uses this |
| Python `scipy` | `1.16.3` | `scipy.stats.beta.rvs` for Thompson Sampling sampling | Already installed; provides `Beta.rvs()` equivalent to `random.betavariate`; Subway's `train_from_feedback.py` uses stdlib `random.betavariate` instead — no additional dep needed |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Node.js built-in test runner (`node --test`) | Unit tests for all new thumbgate scripts | Already the test runner used by the project; do NOT add jest or vitest |
| Python 3.14 (system) | Run Thompson Sampling trainer and venv scripts | Already at 3.14.3; no version change needed |
| Python venv at `.claude/scripts/feedback/venv/` | Isolated deps for Subway feedback scripts | Already has lancedb 0.27.1, sentence-transformers 3.0.1, torch, scipy installed |

---

## Installation

### For thumbgate (new deps only)

```bash
# Only these three are new — everything else stays zero-dependency
cd /path/to/thumbgate

npm install @lancedb/lancedb@0.26.2
npm install apache-arrow@18.1.0
npm install @huggingface/transformers@3.8.1
```

### For Subway_RN_Demo (no new npm deps)

The governance scripts (budget-guard, intent-router, contextfs, self-healing, mcp-policy) require no npm packages. They copy directly from thumbgate with path adjustments only.

```bash
# No npm install needed.
# Copy scripts, adapt FEEDBACK_DIR / PROJECT_ROOT env vars for Subway path layout.
```

### Python side (no action needed)

```bash
# Verify existing venv is current
/path/to/Subway_RN_Demo/.claude/scripts/feedback/venv/bin/python -m pip show lancedb
# Expected: 0.27.1 — already installed
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `@lancedb/lancedb` JS SDK | `vectordb` (legacy LanceDB JS) | Never — `vectordb` is the old package name, now deprecated; `@lancedb/lancedb` is the current package |
| `@huggingface/transformers` v3 | `@xenova/transformers` v2 | Never for new code — @xenova is the old org; v3 was rebranded to @huggingface/transformers; same codebase |
| `@huggingface/transformers` v3 | Python subprocess + sentence-transformers | Only if you need embedding quality beyond all-MiniLM-L6-v2 (e.g., e5-base-v2) and cannot use Node.js inference; adds process spawning latency |
| Native `Math.random()` Beta | `jStat` or `ml-stat` | Only if you need a full statistical distribution library elsewhere in the codebase; overkill for a single Beta-Bernoulli sampler |
| `@huggingface/transformers` v3 | Anthropic Embeddings API | Do NOT use for embeddings — violates the $10/month budget cap; local inference is free |
| Native Node.js `node --test` | Jest / Vitest | Never for thumbgate — the project already uses `node --test`; adding a test framework breaks the zero-dependency stance |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `vectordb` (npm) | Deprecated legacy package name for LanceDB JS; last meaningful release was 0.21.x; redirects to @lancedb/lancedb | `@lancedb/lancedb@0.26.2` |
| `@xenova/transformers` | Old package name for Transformers.js v2; v3 was rebranded to @huggingface/transformers | `@huggingface/transformers@3.8.1` |
| `@huggingface/transformers@4.x-next` | Still in preview (dist-tag `next: 4.0.0-next.5`); API unstable | `@huggingface/transformers@3.8.1` (stable) |
| `@lancedb/lancedb@0.27.0-beta.*` | Beta; API includes breaking changes (`napi-rs v3` upgrade); may affect native binary loading | `@lancedb/lancedb@0.26.2` (stable) |
| Anthropic API for embeddings | Costs money per call; violates $10/month budget cap | `@huggingface/transformers` local ONNX inference |
| `chromadb` (npm or Python) | Subway's local-rag.py uses ChromaDB as a fallback, but LanceDB is already the primary store (see `lance-index-state.json`); ChromaDB adds a second vector DB with no benefit | `@lancedb/lancedb` exclusively |
| Any Python ML library added to thumbgate | thumbgate is a Node.js-only project; adding Python deps breaks the architecture | Node.js-native alternatives (@huggingface/transformers for embeddings) |

---

## Stack Patterns by Variant

**If adding Thompson Sampling to thumbgate (JS):**
- Implement `BetaBernoulliModel` as a pure JS class with `alpha`/`beta` per category
- Use `Math.random()` for `betavariate` approximation (Johnk's method or accept stdlib approximation)
- Store model state in `feedback_model.json` (mirrors Subway's `train_from_feedback.py` storage)
- Because Node.js 25 has no `scipy.stats` equivalent, implement the Beta inverse CDF using the regularized incomplete Beta function — OR use the simpler approximation: `sample = -Math.log(Math.random()) / alpha` which is a Gamma approximation sufficient for bandit exploration

**If adding LanceDB vector storage to thumbgate (JS):**
- Use ESM import (`import { connect } from '@lancedb/lancedb'`) — the package is ESM-only in 0.26.x
- BUT thumbgate is CommonJS (`"type": "commonjs"` in package.json) — use dynamic import: `const { connect } = await import('@lancedb/lancedb')`
- Store the LanceDB files in `FEEDBACK_DIR/lancedb/` to mirror Subway's path layout
- Use `all-MiniLM-L6-v2` via `@huggingface/transformers` for 384-dim embeddings (same model Subway uses)

**If adding LSTM sequence features to thumbgate (JS):**
- The LSTM architecture in Subway is purely data-structural (no actual PyTorch LSTM): `buildSequenceFeatures()` produces `rewardSequence`, `tagFrequency`, `recentTrend`, `timeGaps` arrays
- Port the JavaScript implementation directly from `capture-feedback.js` in Subway — no ML library required
- Store sequences in `feedback-sequences.jsonl` (same schema as Subway)

**If adding diversity tracking to thumbgate (JS):**
- Track category distribution across `DOMAIN_CATEGORIES` array
- Compute Gini coefficient or Shannon entropy over category counts to detect representation collapse
- Store in `diversity-tracking.json` (mirrors Subway's `DIVERSITY_FILE`)
- No external library needed — pure JS arithmetic

**If adding RLAIF self-scoring to thumbgate:**
- Call the Claude API (Anthropic SDK `@anthropic-ai/sdk@0.78.0`) to score rubric criteria automatically
- Budget guard MUST wrap every RLAIF call — charge $0.001–$0.01 per scoring call to the ledger
- Only invoke RLAIF when `THUMBGATE_ENABLE_RLAIF=true` env var is set (opt-in to prevent surprise costs)

**If porting governance scripts to Subway_RN_Demo:**
- Scripts are CommonJS with zero deps; copy verbatim, then set `THUMBGATE_FEEDBACK_DIR` to point to Subway's `.claude/memory/feedback/`
- The `THUMBGATE_MONTHLY_BUDGET_USD` env var defaults to `10` — matches the project constraint
- Self-healing monitor wraps existing `jest --watchman=false` and Expo prebuild commands (not the same checks as thumbgate's `npm test`)

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@lancedb/lancedb@0.26.2` | `apache-arrow@>=15.0.0 <=18.1.0` | Arrow 21.x (latest) is OUT of range; pin arrow to `18.1.0` |
| `@lancedb/lancedb@0.26.2` | `node >= 18` | Project is at 25.6.1 — compatible |
| `@huggingface/transformers@3.8.1` | Node.js ESM + CommonJS via dynamic import | Works in CommonJS via `await import()` |
| `lancedb@0.27.1` (Python) | `sentence-transformers@3.0.1` | Both already installed in Subway venv; compatible |
| `sentence-transformers@3.0.1` | `torch` (any recent) | Subway venv has torch installed; no version conflict |

---

## Sources

- npm registry (live query): `@lancedb/lancedb` — version 0.26.2 stable, `node >= 18` engine, `apache-arrow >=15.0.0 <=18.1.0` peer dep — HIGH confidence
- npm registry (live query): `@huggingface/transformers` — version 3.8.1 stable, v4 still in preview (`next` dist-tag) — HIGH confidence
- npm registry (live query): `@anthropic-ai/sdk` — version 0.78.0 — HIGH confidence
- `pip3 show lancedb` (verified on this machine): 0.27.1 — HIGH confidence
- `pip3 show sentence-transformers` (verified): 3.0.1 — HIGH confidence
- `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/memory/feedback/lance-index-state.json` — confirms LanceDB is active, using all-MiniLM-L6-v2 — HIGH confidence
- `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/train_from_feedback.py` — confirms Thompson Sampling uses pure stdlib `random.betavariate`, no external library — HIGH confidence
- `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/capture-feedback.js` — confirms LSTM sequence features are pure JS data structures — HIGH confidence
- `/Users/ganapolsky_i/workspace/git/igor/ThumbGate/package.json` + `package-lock.json` — confirms zero npm dependencies, CommonJS module type — HIGH confidence
- GitHub releases: https://github.com/lancedb/lancedb/releases — 0.27.0-beta.3 latest beta, 0.26.2 latest stable — MEDIUM confidence
- HuggingFace blog: https://huggingface.co/blog/transformersjs-v4 — v4 is preview only — MEDIUM confidence

---

*Stack research for: ThumbGate Bidirectional Feature Sync*
*Researched: 2026-03-04*
