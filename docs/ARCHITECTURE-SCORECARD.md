# Architecture scorecard — 2026-07-27

Honest assessment across five architectures, scored **twice**: what exists in the repo, and
what is actually running in production. The delta between those two columns is where every
surprise in the 2026-07-26/27 session came from.

Two things built and never wired caused real incidents that day:

- `workspaceHydrated` was computed correctly and read by nothing — users were told "No tasks
  yet, pair a machine" while their data loaded.
- `~/.thumbgate/bin/thumbgate-hook` went missing on the mini and **enforcement silently died**
  — every PreToolUse hook failed open for an unknown period.

So "the code exists" is not a passing grade anywhere below.

| Area | Repo | Deployed |
|---|---|---|
| RAG / retrieval | B | C− |
| Agent with tools | A− | B+ |
| Multi-agent workflow | B+ | B |
| MCP enterprise integration | B+ | B− |
| Production eval & observability | B− | **D** |

---

## 1. RAG / retrieval — repo **B**, deployed **C−**

**Why this architecture.** Lessons from past failures are retrieved and injected before a tool
call so the agent sees prior mistakes at decision time. Retrieval is hybrid: `lesson-db.js`
(SQLite), `lesson-retrieval.js`, embeddings, and `cross-encoder-reranker.js`.

**What can fail.** Three modes, all observed:
1. *Retrieval matches on noise.* Guard keywords were substring-matched against a JSON envelope,
   so its own key names (`files`, `command`, `path`) were in the haystack on every evaluation.
   Any guard containing two common words matched everything. Fixed 1.29.2.
2. *Retrieval returns contradictions.* Handled — `calculateRetrievalEntropy()` with a 0.7
   threshold, and high entropy correctly *softens* to advisory rather than blocking.
3. *The corpus vanishes.* `lessons.sqlite` was wiped on the mini on 2026-07-26 and is
   unrecoverable. Nothing backs up `~/.thumbgate`.

**How we measure it.** `eval-rag.js` computes `context_precision` via LLM judge. **`evals/` is
empty** — there is no golden set, so precision is computed against whatever is at hand and is
not comparable between runs. Nothing schedules it.

**How we secure it.** `sanitizeFeedbackText()` strips hook transport payloads and redacts
`/Users/<name>` and ports before anything is persisted.

**How we deploy it.** Ships inside the npm package; corpus is local per machine.

**How we know it works.** *We largely don't.* Unit tests cover the matcher; no benchmark
covers retrieval quality. **Top gap: build a golden set in `evals/` and schedule `eval-rag`.**

---

## 2. Agent with tools — repo **A−**, deployed **B+**

**Why this architecture.** A PreToolUse gate evaluates every tool call against declarative
gates plus learned rules, returning allow / warn / deny.

**What can fail.**
- *Bypass.* Gate patterns anchored command position as `(?:^|[;&|]\s*)`, so `sudo rm -rf /`
  matched no gate at all. **62 measured evasion holes** in 1.29.1; 0 in 1.29.2.
- *Fail-open.* A missing hook shim makes the hook error, and an erroring PreToolUse hook fails
  open. This happened and was invisible.
- *Over-blocking.* Correctly-scoped `git add` reported 2091 affected files instead of 2.
- *Denial-of-guardrail.* Two polynomial-ReDoS regexes on tool-call input — stalling the gate
  defeats it as surely as bypassing it.

**How we measure it.** `tests/gate-evasion-matrix.test.js` — corpus × 9 re-spellings, asserted
to zero holes, in CI. `enforcement-drift-watch.yml` runs the same grid against the *published
tarball* every 6h. That distinction matters: tests prove the source is right, the watcher
proves the artifact users receive is right, and the second was false for months.

**How we secure it.** `runHardFloor()` runs before any bypass, so secret exfiltration, the
security scanner and the four self-protection gates survive `THUMBGATE_HOTFIX_BYPASS=1`.

**How we deploy it.** npm, provenance-signed, `v*` tags. Machines do **not** auto-upgrade —
the MCP wrapper only fetches `@latest` when `runtime/node_modules` is absent.

**How we know it works.** Strongest area. Differential proof against a known-bad version:
1.29.1 → 34 holes, 1.29.2 → 0. **Remaining gap: `$(which git)` subshell resolution still
evades** — static canonicalization cannot resolve a subshell; needs exec-time gating.

---

## 3. Multi-agent workflow — repo **B+**, deployed **B**

**Why this architecture.** Several agents (Claude, Codex, Cursor, Gemini) work the same repos
concurrently, coordinating through `plan.md` claims and an Obsidian vault at
`~/Documents/AI-Agent-Sync` with `Agent-Jobs/running/` claim files. Isolation via git worktrees.

**What can fail.** Collision on hot files. `plan.md:78` marks `DashboardClient.tsx` HOT /
multi-owner; it has collided repeatedly. The protocol is advisory — nothing enforces it.

**How we measure it.** Claim files and `plan.md`. No automated collision detection.

**How we secure it.** Branch protection, required conversation resolution, PR-only main. This
is the layer that actually works: on 2026-07-27 the conversation-resolution gate blocked a
merge carrying five P1 defects that all 19 CI checks had passed.

**How we deploy it.** Worktree per agent, sequential merge.

**How we know it works.** Today's evidence: five active worktrees were checked for diffs on a
hot file before editing, and the check was cheap. **Gap: that check is manual.** A pre-commit
hook that warns when touching a file listed HOT in `plan.md` would make it automatic.

---

## 4. MCP enterprise integration — repo **B+**, deployed **B−**

**Why this architecture.** ThumbGate exposes ~90 MCP tools; consumers are agent runtimes.
Profiles gate which tools are reachable: `default, essential, commerce, readonly, dispatch,
locked` in `config/mcp-allowlists.json`.

**What can fail.**
- *Over-broad tool exposure.* Mitigated by profiles — `readonly` and `locked` exist and matter.
- *Missing tool annotations.* `readOnlyHint` / `destructiveHint` are set in
  `adapters/skool/server-stdio.js` but **not** in the main ThumbGate MCP server. Clients cannot
  distinguish a read from a destructive write without out-of-band knowledge.
- *Auth.* `mcp-oauth.js` and `entitlement.js` exist; entitlement failures currently degrade to
  advisory mode with a license notice rather than denying.

**How we measure it.** `test:mcp-config`, `test:mcp-tool-annotations`, `test:mcp-oauth`.

**How we secure it.** Profile allowlists + OAuth + entitlement checks.

**How we deploy it.** stdio adapter shipped in the npm package.

**How we know it works.** Config-level tests pass. **Gap: add `readOnlyHint`/`destructiveHint`
to the main server's tool definitions** — cheap, and it is what lets a client refuse to
auto-approve a destructive tool.

---

## 5. Production eval & observability — repo **B−**, deployed **D**

This is the weak one, and the gap is not subtle.

**What exists in the repo:** `eval-harness.js`, `eval-rag.js`, `gate-eval.js`,
`decision-trace.js`, `agent-audit-trace.js`, `agent-reasoning-traces.js`,
`async-eval-observability.js`, `action-receipts.js`, `slo-alert-engine.js`,
`session-health-sensor.js`, `llm-behavior-monitor.js`. That is a serious observability
surface, and 496 test files behind it.

**What actually runs on a schedule:**

| script | in a workflow? | in cron/launchd? |
|---|---|---|
| `gate-eval` | yes (1) | no |
| `eval-harness` | **no** | no |
| `eval-rag` | **no** | no |
| `decision-trace` | **no** | no |
| `agent-audit-trace` | **no** | no |
| `async-eval-observability` | **no** | no |
| `action-receipts` | **no** | no |
| `slo-alert-engine` | **no** | no |

One of eight. Everything else runs only if a human types the command — which means in practice
it does not run.

**No OpenTelemetry instrumentation anywhere.** Against the July 2026 baseline (OTel GenAI
semantic conventions v1.41: agent/workflow/tool/model spans, required latency and token
metrics) we have none of it. Worth noting the conventions explicitly stop short of output
evaluation and policy enforcement — ThumbGate's actual domain — so OTel would not have caught
the bypasses. It would have caught the state loss.

**What this cost us.** On 2026-07-26 the mini's `~/.thumbgate` went from ~50 files to 4 —
lessons DB, feedback log, gate stats, governance state, audit trail, all gone, unrecoverable.
Nothing alerted. It was found by accident while looking for test data. Separately, enforcement
on that machine was entirely dead (missing shim) for an unknown period, also silently.

**What now exists:** `gate-decision-canary.js` detects enforcement drift — a gate going
*silent* is the signature of a bypass — and `enforcement-drift-watch.yml` runs the evasion
matrix against the published artifact every 6h with an automatic P0 issue naming the rollback
command.

**Ranked gaps:**
1. **Nothing backs up `~/.thumbgate`.** A repeat loses everything again. Cheapest high-value fix.
2. **Schedule the observability that already exists** — start with `slo-alert-engine` and
   `action-receipts`; the code is written and idle.
3. **No golden set in `evals/`** — retrieval quality is unmeasurable between runs.
4. **No OTel spans** — largest structural gap, lowest urgency relative to 1–3.

---

## The pattern worth internalising

Three separate incidents in one session shared one shape: **something was built correctly and
then not connected.** `workspaceHydrated` computed and unread. `slo-alert-engine` written and
unscheduled. The hook shim installed and later missing, with nothing checking.

A build-time test cannot catch any of these, because at build time the code is correct. The
only checks that catch them run against the *deployed system* and assert that a signal is
actually flowing — which is precisely what the drift watcher does, and why it should be the
template for closing gaps 1–3.
