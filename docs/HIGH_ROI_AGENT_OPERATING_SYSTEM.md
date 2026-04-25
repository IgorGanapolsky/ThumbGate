# High-ROI Agent Operating System

ThumbGate is the operational harness around AI agents: permissioned routines, evidence gates, memory governance, isolated task lanes, and data-table validation before agents act.

## Workspace Agents

- Run scheduled or webhook-triggered routines only on feature branches.
- Require evidence before merge: branch, SHA, tests, decision journal, and PR URL or no-change reason.
- Treat connector writes to Slack, Salesforce, Gmail, Drive, Notion, Jira, Linear, and similar systems as approval-gated actions.
- Gate system-prompt, reasoning-effort, and verbosity changes with per-model evals, ablations, public-build parity, and soak evidence.
- Treat new frontier model defaults as migrations, not assumptions: benchmark proof suites, token cost per verified task, unsupported-claim rate, computer-use errors, and research-loop persistence before high-risk routing.
- Do not imply gated preview models are available until the organization is approved; platform setup comes after eligibility.

## Data Table Agents

- Define table schemas as first-class artifacts before agent ETL work starts.
- Require every generated row to carry `row_id`, `source_hash`, `ingested_at`, `qa_status`, and `qa_notes`.
- Allow schema evolution only after review; destructive migrations need rollback evidence.
- Reconcile generated aggregates against source totals before dashboards or claims use them.

## Prompt Programs

- Treat prompts as runtime programs.
- Use CRE for reusable prompts: Context, Role, Expectations.
- Use Task -> Context -> Result for workspace-agent dispatches.
- Require paste-ready output formats, length caps, and safety boundaries for critical workflows.
- Add few-shot examples only when zero-shot CRE output drifts.

## Isolated Task Lanes

- Keep a durable baseline repo.
- Fork one isolated Artifact/worktree per task.
- Run agents with `read`, `write`, `run_tests`, and `commit` tools.
- Review fork diffs, tests, logs, and decision-journal entries before merging.

## Managed Memory

- File-backed memories are useful only when reviewable, portable, and redactable.
- Use a graph-backed knowledge layer when the workflow needs explainable paths across users, workflows, feedback, gates, evidence, decisions, and outcomes.
- Separate memory by type: working, episodic, semantic, procedural, and preference.
- Promote working memory only when tied to outcome evidence.
- Promote semantic memory only after deduplication and contradiction checks.
- Promote procedural memory only after test or replay evidence.
- Promote preference memory only after an explicit user signal.
- Block credential-like memory files from promotion or export.
- Redact account/customer context before shared memory export.
- Promote only actionable memories that can become gates or better prompt programs.
- Treat synthetic training data as unsafe until provenance is known: teacher model, student model, base-model family, prompt hash, filter report, redaction report, and dataset version.
- For teacher/student pairs with the same base-model family, require hidden-trait behavioral probes before promoting generated lessons into training or eval data.
- Keyword filtering is not enough; promotion requires semantic filters plus behavioral holdout checks.

## AI Company Governance

- Give persistent agents narrow roles, monthly budgets, and ticket templates.
- Require approval for new agent roles, budget increases, credentialed connector writes, production releases, and public claims without evidence.
- Review daily ticket outcomes, spend by role, blocked actions, and open approvals.
- Review weekly low-ROI tickets, stale agents, budget cap changes, and policy drift.

## Production Agent Readiness

- Split monolithic agents into narrow sub-agent stages.
- Use runtime-validated structured outputs instead of prompt-only JSON formatting.
- Replace hardcoded context with refreshed retrieval over indexed source material.
- For hybrid questions across tables, graph relationships, and documents, use a multi-step supervisor that decomposes the query, calls native sources in parallel, reconciles results, and self-corrects empty overlaps.
- Add new enterprise data sources with plain-language source descriptions and incremental rollout; avoid connecting every source at once.
- For broad API surfaces, prefer a code-mode MCP pattern: `search` the API catalog, then `execute` bounded code against typed helpers in a sandbox.
- Keep code-mode execution isolated: no filesystem, no exposed environment variables, explicit outbound handlers only, and idempotency keys for writes.
- Emit traces for model calls, tool calls, tokens, latency, and stage failures.
- Install retry, timeout, loop, and spend circuit breakers before production use.
- Scale reasoning depth by task difficulty, dollar impact, and budget instead of defaulting every task to maximum inference.

## Creator Growth Motion

- Package the system as a webinar: "Stop AI Agents From Repeating Expensive Mistakes."
- Put advanced templates behind a metered paywall or paid trial.
- Use newsletter, LinkedIn, and webinar loops to demonstrate feedback -> gate -> replay blocked -> proof export.
- Repeat the same entity claims across machine-readable fragments, public context docs, GitHub, npm, social posts, comparison pages, and proof assets so AI search systems can cite ThumbGate consistently.
