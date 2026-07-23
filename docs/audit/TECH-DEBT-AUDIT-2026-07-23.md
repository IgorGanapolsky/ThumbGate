# Technical Debt Audit — 2026-07-23

## Scope honesty

This audit does **not** claim a complete line-by-line rewrite of all ~1,800 tracked files.
It establishes a **measured baseline**, removes **evidence-proven waste**, and documents
remaining debt so follow-up work is scoped.

Full “100% coverage / every DRY violation in 500 scripts” is multi-sprint work.

## Baseline (commit `d8d31f2c` / main at audit start)

| Metric | Value |
|--------|------:|
| Tracked files | 1,811 |
| Tracked lines (approx) | 485,430 |
| Root files (non-dot) | 24 |
| Root dirs | 22 |
| Primary language | JS (~1,082 files) |
| Python | 8 files |
| Markdown | 243 files |
| Main CI (workflow `ci.yml`) | **SUCCESS** on `d8d31f2c` — https://github.com/IgorGanapolsky/ThumbGate/actions/runs/30007312287 |
| Package version | 1.28.4 |
| npm scripts | ~479 |
| `package.json` `files` allowlist entries | ~274 |

### Coverage

Full-suite coverage was **not** re-run to 100% in this pass (multi-hour `npm test` matrix).
Use `npm run test:coverage` for a fresh local percentage. Target 100% remains **aspirational**
for this monorepo size; enforce high coverage on **core runtime** (`scripts/gates-engine.js`,
hooks, CLI, API) before claiming 100% repo-wide.

### Protected systems snapshot

| System | Status at baseline |
|--------|-------------------|
| Main CI | Passing on audit base commit |
| Hosted product path | Railway deploy from main (unchanged this PR) |
| Local lesson/RAG paths | gitignored (`.claude/memory/feedback/*`) — not in package |
| Orchestration / gates | Not modified in this cleanup PR |

## Root cause of “messy repo”

See prior analysis: product + hosted SaaS + multi-agent ops + prototypes share one tree.
GitHub root mixes marketplace manifests, agent directives, and ops docs.

## Actions taken this PR

### Deleted (with justification)

| Path | Justification |
|------|----------------|
| `prototypes/manufacturing-copilot/db/**` (80 tracked files) | Runtime SQLite + LanceDB index/txn/manifest artifacts. **Zero source files.** Should never have been committed. |

### Moved

| From | To | Why |
|------|-----|-----|
| `plan.md` | `docs/revenue-plan.md` | Revenue planning doc does not belong at package root |

### Gitignore hardened

- `prototypes/**/db/`
- `**/*.sqlite-shm`, `**/*.sqlite-wal`
- `undefined/`, `tmp/`
- `**/lancedb/`
- local screenshot patterns `nova-*.png`, `shawn-*.png`

### Intentionally left at root (active references)

| File | Why |
|------|-----|
| `gate-program.md` | Read by `scripts/meta-agent-loop.js` and CLI hard-block path |
| `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` / `SKILL.md` | Agent operator contract |
| `glama.json`, `mcpize.yaml`, `smithery.yaml`, `opencode.json`, `server.json` | Marketplace/MCP discovery expects root or known paths |
| `RELEASE_TRIGGER` | Deploy kick file historically used by automation |
| `MOAT.md`, `THREAT_MODEL.md`, `WORKFLOW.md` | Public strategy/security surfaces; move requires test/doc path updates |

## Issues found (not all fixed)

| Area | Finding | Priority |
|------|---------|----------|
| Scale | ~500 scripts + ~500 tests | P1 structure |
| Packaging | Explicit `files` allowlist ~274 entries | P1 |
| Root | Marketplace + agent docs mixed | P2 |
| Prototypes | Only binary DB was tracked | **Fixed** |
| Coverage | Repo-wide 100% unrealistic without split | P1 strategy |
| Python | Only 8 files; secondary | P3 |
| RAG | Local gitignored lesson DB — clean on operator machines, not in git | Ops |
| Local dirty trees | Primary checkouts accumulate untracked PNGs/`undefined/` | Ops hygiene |

## Recommended follow-ups (next PRs)

1. **Root hygiene PR:** `docs/agent/` for operator md; `integrations/marketplaces/` for manifests (update external docs)
2. **Package split design:** runtime vs ops scripts
3. **Coverage ratchet:** core modules only, raise floor each sprint
4. **Script ownership map:** `scripts/core`, `scripts/ops`, `scripts/marketing`
5. **CI:** fail if new root files appear without allowlist update

## After metrics (this PR)

| Metric | Before | After |
|--------|-------:|------:|
| Tracked files | 1,811 | 1,732 |
| Files deleted | — | 80 (prototype DB only) |
| Files moved | — | 1 (`plan.md` → `docs/revenue-plan.md`) |
| Files added | — | 1 (this audit report) |
| Root noise reduced | prototype dir gone | gitignore ratchet added |

Line count for deleted binaries is not meaningful in `wc -l` (binary); ~4.4MB removed from tree size.

## RAG note

Git-tracked repo does not contain live lesson DB. Local RAG under `.claude/memory/feedback/` is gitignored. No production lesson purge performed (would require operator machine). Recommend operator-side: `npm run feedback:stats` + prune duplicates when reviewing.
