# ThumbGate + Databricks

**Status:** Composable, not integrated. No live MLflow tracking, no Unity Catalog adapter, no Vector Search swap. This doc explains how ThumbGate **composes** with a Databricks-mandated MLOps stack so the conversation can happen credibly without speculative engineering ahead of a real customer LOI.

**Audience:** prospects whose RFP / job spec calls out Databricks, MLflow, Unity Catalog, Mosaic AI, or Databricks Vector Search as the platform of record; field engineering during scoping calls; recruiter conversations where "Databricks exposure" is on the requirement list.

---

## What ThumbGate is (and isn't) in a Databricks shop

ThumbGate is a **behavioral enforcement layer for AI agents** that sits between the agent and the tools it can invoke. It runs locally (CLI + MCP hook) and produces three classes of artifact that a Databricks shop already has consumers for:

1. **Lesson data** — every thumbs-up/down becomes a structured lesson with context, action, evidence, outcome.
2. **Gate decisions** — every pre-action check produces an audit row: which agent, which tool, which policy, allow/require-evidence/block, why.
3. **DPO preference pairs** — accept/reject pairs ready for fine-tuning.

What ThumbGate **does not** do: replace MLflow as your tracking server, replace Unity Catalog as your governance layer, replace Vector Search as your retrieval store. It feeds those systems, it doesn't compete with them.

If a prospect tells you "we already have Databricks for the MLOps stack" — that's the strongest possible signal that ThumbGate is the right complement, not the replacement.

---

## Composition map

| Databricks pillar | ThumbGate adapter / export | Maturity |
|---|---|---|
| **MLflow Tracking** | `scripts/export-databricks-bundle.js` produces a DPO/lesson bundle; an MLflow tracking shim that registers each promoted rule as a run with params (intent, severity, gate-action) and artifacts (rule text, evidence) is the natural next step. | File producer today. Live tracking shim is ~3 days. |
| **MLflow Model Registry** | Fine-tuned models distilled from DPO pairs land in MLflow Registry. ThumbGate provides the *training data*; MLflow tracks the resulting model. | Indirect: produces inputs, doesn't register models itself. |
| **Unity Catalog** | Export adapter writes to a UC-governed Delta table (`<catalog>.thumbgate.lessons`, `<catalog>.thumbgate.gate_decisions`, `<catalog>.thumbgate.dpo_pairs`). Schemas already aligned with `feedback-schema.js`. | Schema is ready; UC Delta writer is the missing adapter. |
| **Mosaic AI Foundation Model API** | ThumbGate's LLM router is vendor-neutral and accepts any HTTP-callable model endpoint. Routing to DBRX, Llama-via-Mosaic, or Anthropic-via-Mosaic-passthrough is a config-only swap. | Routable today via existing LLM client; no Mosaic-specific token wiring yet. |
| **Mosaic AI Agent Framework** | ThumbGate gates compose around agents built in any framework, including Mosaic AI Agent Framework. The MCP-stdio transport is framework-agnostic. | Compatible today, no framework-specific integration. |
| **Databricks Vector Search** | The lesson store is plugin-shaped (LanceDB by default). A Vector Search adapter replaces the LanceDB call site with the Databricks Python/REST client and gains UC-governed retrieval. | Plugin point exists; adapter is the work. |
| **Databricks Lakebase** | Lakebase governs the *data foundation* the agent reads from and writes to (apps, agents, analytics on one Postgres-compatible store inside Unity Catalog). ThumbGate governs the *tool-call boundary* into that store — every `INSERT`, `UPDATE`, `DELETE`, or external-API call the agent attempts. The two layers compose: Lakebase keeps the data lineage; ThumbGate keeps the decision lineage. The published Lakebase case studies (Superhuman, Replit, YipitData, Intent HQ, Ensemble Health) are exactly the profile — production agents at scale — where adding a PreToolUse governance layer pays for itself within the first month of repeat-failure blocks. | Compatible today, no Lakebase-specific token wiring. Worth pulling in by signed pilot. |

---

## Honest readiness grades (no marketing)

| Capability | Today | What real integration costs |
|---|---|---|
| MLflow tracking shim | Absent | 2–3 days |
| Unity Catalog Delta export | Absent (schema-ready) | 3–5 days incl. permissions / catalog setup |
| Vector Search adapter (replace LanceDB) | Absent | 4–6 days incl. ingest + retrieval tests |
| Mosaic AI Foundation Model routing | Routable, untested in prod | 1 day to wire + soak |
| Databricks SQL access to ThumbGate artifacts | None | 2 days after the UC Delta export lands |

**Total:** ~3 weeks of focused work for the full Databricks-native readiness. Not built on speculation. Pulled by a signed pilot.

---

## Why Lakebase + ThumbGate compose well

Databricks Lakebase positions itself as the **governed data foundation** for apps + agents + analytics — a Postgres-compatible store inside Unity Catalog where the agent's reads and writes share lineage with the rest of the warehouse. That answers "what data did the agent touch?" with auditable precision.

It does not answer "what tool calls did the agent attempt that we stopped?" — and it isn't trying to. That's a different lineage type: per-call evidence + per-rule provenance + the corrective action that fired. Lakebase + ThumbGate split the audit surface cleanly:

| Question the auditor asks | Lakebase answers | ThumbGate answers |
|---|---|---|
| What did the agent read/write? | ✅ row-level lineage inside Unity Catalog | partial (only what the agent reported back to the gate) |
| What tool calls did we let the agent attempt? | partial (only those that hit Lakebase) | ✅ every tool call across every adapter |
| What did we **stop** the agent from doing, and why? | ❌ | ✅ PreToolUse gate verdict + rule that fired + lesson that promoted it |
| How is this kept current as the agent's model changes? | UC migration tooling | adapter matrix CI-checked against upstream |

The Lakebase customer wins Databricks published (Superhuman shipping 6× faster, Replit launching production code-gen in 3 weeks, YipitData processing 1M records/hour) all describe agents at scale where one failed tool-call shape, repeated thousands of times, is meaningful spend. That's the exact failure pattern ThumbGate's lesson DB → PreToolUse gate promotion is built for. The two are stack-mates, not substitutes.

---

## Why open-weights + Databricks compose well

For federal and regulated workloads (see [`FEDERAL.md`](./FEDERAL.md)), open-weights inside Databricks Mosaic AI hits multiple constraints at once:

- **Sovereignty:** the model and its weights live inside the agency's Databricks workspace; no outbound vendor call.
- **Auditability:** training data, fine-tunes, and inference behavior are inspectable via MLflow + UC lineage.
- **Customization on sensitive data:** DPO fine-tuning of agency-specific models becomes a first-class workflow inside Mosaic AI.
- **Continuity of operations:** Llama/Mistral/DBRX weights persist independent of any single vendor's commercial decisions.

ThumbGate produces the DPO data that feeds this loop. It's the *data-side* of the open-weights mission, regardless of which model the prospect lands on.

---

## What to say in a scoping call

If a prospect asks "do you integrate with Databricks?" — the truthful answer is:

> "ThumbGate composes with the Databricks stack rather than replacing any of it. We produce the lesson data, gate decisions, and DPO preference pairs in schemas that map cleanly to Unity-Catalog-governed Delta tables. The MLflow tracking shim and Vector Search adapter are about three weeks of focused work that we'd start on a signed pilot, not on speculation. The composition map and schemas are public in `docs/DATABRICKS.md`."

That's enough to keep the conversation alive without overcommitting. It also signals you understand the platform — most ThumbGate-style competitors lead with "we'll build whatever you need," which reads as no real position.

---

## Pre-LOI deliverables (cheap, public)

- `scripts/export-databricks-bundle.js` — already ships in npm; produces a DPO + lesson bundle ready for MLflow run import.
- `feedback-schema.js` + the existing lesson DB schema — public, document the column layout for the Delta tables.
- `proof/lancedb-report.md` — documents the current vector store choice and the rationale for picking LanceDB locally vs. Databricks Vector Search in a hosted-Databricks shop.

These three artifacts are enough to take a Databricks-mandated prospect from cold inbound to a 30-minute scoping call without writing a single new line of Databricks code.

---

## Sequencing (mirrors `docs/FEDERAL.md`)

- **Phase 0 — Now:** this doc, the composition map, the bundle exporter. No prospect commitment required.
- **Phase 1 — On scoping call:** screenshare walking through the schema mapping; identify which of the three adapters (MLflow tracking, UC Delta export, Vector Search) the prospect actually needs first.
- **Phase 2 — On signed pilot:** build the one or two adapters the prospect actually uses. Don't build all three until usage proves it.
- **Phase 3 — On second customer with same need:** generalize the adapter, ship as opt-in module.
- **Phase 4 — Pulled by demand only:** native Databricks Apps deployment, Mosaic AI Gateway integration, agent registry inside UC.

Code work waits for a real customer LOI. Same principle as federal RAG, federal compliance buildout, and on-prem deployment in `docs/FEDERAL.md`.

---

## Related

- [`docs/FEDERAL.md`](./FEDERAL.md) — federal-agency positioning brief, same sequencing model.
- [`proof/lancedb-report.md`](../proof/lancedb-report.md) — current vector store choice and tradeoffs.
- [`scripts/export-databricks-bundle.js`](../scripts/export-databricks-bundle.js) — the existing DPO/lesson exporter.
- [`CLAUDE.md`](../CLAUDE.md) — public/Core boundary rules; Databricks adapters land in Core, not the npm bundle, when built.
