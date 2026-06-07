# AI Coding Project Management Operating Model

Updated: 2026-06-07

This is ThumbGate's project-management contract for AI-assisted coding work. It turns product goals into agent-ready issues, keeps GitHub as the source of truth, and requires proof before claims, releases, or follow-up automation.

## Research Snapshot

Current June 2026 signals point in the same direction:

- GitHub Projects should be the canonical engineering source of truth: project views, custom fields, iterations, automation, insights, templates, and repository linkage keep issues and pull requests from drifting across tools. Source: https://docs.github.com/en/enterprise-server@3.16/issues/planning-and-tracking-with-projects/learning-about-projects/best-practices-for-projects
- GitHub Issue Fields are replacing label-only project metadata with typed fields such as Priority, Effort, Start date, and Target date, plus API/webhook support. Source: https://github.blog/changelog/2026-03-12-issue-fields-structured-issue-metadata-is-in-public-preview/
- GitHub Copilot cloud agent can take scoped backlog issues, research/plan, create branches, and work in the background, while pull-request lifecycle metrics track agent PR throughput and time-to-merge. Source: https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent
- OpenAI Codex is explicitly positioned for parallel, worktree-backed multi-agent coding, with Skills and Automations for the non-code work around pull requests. Source: https://openai.com/codex/
- OpenAI's Codex safety guidance makes agent-native telemetry non-optional: logs should capture prompts, tool approvals, tool results, MCP usage, and network allow/deny decisions. Source: https://openai.com/index/running-codex-safely/
- Linear is now an agent work hub: Codex, Cursor, Copilot, Devin, Sentry, and others can work from issues; Linear's guidance is strongest when product/customer context lives in Linear and code history lives in the repo. Sources: https://linear.app/agents and https://linear.app/now/how-cursor-integrated-with-linear-for-agents
- End-to-end project benchmarks still show agent weakness on complex system design and resource management, so every large goal must be decomposed into bounded issues with architecture and proof gates. Source: https://arxiv.org/abs/2602.01655

## Tool Decision

Use GitHub Projects + Issues + PRs as the system of record for ThumbGate engineering.

Add Linear only when customer-feedback volume requires triage from Intercom, Slack, email, or sales conversations before engineering work is ready. Linear can be the product intake layer, but GitHub remains the merge/proof layer.

Use Codex for parallel implementation, refactor, docs, dashboard, and test work in isolated worktrees. Use Copilot cloud agent for straightforward GitHub issues, maintenance, and backlog cleanup where GitHub-native branch/PR telemetry is useful. Use Cursor/Claude for local exploration only when the issue explicitly names the local context or IDE workflow required.

## Work Hierarchy

1. Use case: a buyer/operator problem worth solving, written in business language.
2. Milestone: a measurable outcome within 1-3 weeks.
3. Phase: the lifecycle step needed now.
4. Agent-ready issue: one bounded PR-sized unit of work.
5. Proof packet: commands, screenshots, logs, telemetry, and rollout checks that prove the issue is done.

## Standard Phases

| Phase | Goal | Exit Gate |
| --- | --- | --- |
| Discover | Capture customer/operator pain, current evidence, and constraints. | Use case, scope, and non-goals are written in the issue. |
| Design | Decide architecture, data model, UI/API contract, and risk tier. | Plan names files, tests, rollback path, and telemetry. |
| Build | Implement the smallest PR-sized slice. | Diff is scoped; no unrelated files or public scratchpads. |
| Verify | Run proof commands and inspect outputs. | Tests, lint/static checks, dashboard/API smoke, and risk-specific proof pass. |
| Release | Merge through protected PR flow. | CI green, review threads resolved, changeset/release notes present when needed. |
| Observe | Watch production or local adoption telemetry. | Metric moved or a follow-up issue explains why it did not. |

## ThumbGate Use-Case Buckets

- Revenue truth: Stripe, checkout, attribution, visitor journey, and customer activation.
- Agent reliability: repeated mistakes, feedback capture, prevention rules, statusline/dashboard truth.
- Governance and safety: PreToolUse policy, bypass resistance, sensitive data, approvals, audit logs.
- Distribution and GEO: GitHub, npm, marketplace listings, LLM-search surfaces, comparison pages.
- Enterprise pilots: shared lessons, dashboard, export, SSO/compliance, regulated workflow pilots.
- Operator productivity: token burn, background agents, PM automation, technical-debt cleanup.

## Required Project Fields

Use these fields in GitHub Projects or Linear. If GitHub Issue Fields are not enabled, mirror them as labels until fields are available.

| Field | Values |
| --- | --- |
| Use case | revenue-truth, agent-reliability, governance, distribution, enterprise-pilot, operator-productivity |
| Phase | discover, design, build, verify, release, observe |
| Agent lane | human, codex, copilot, cursor, claude, mixed |
| Risk tier | P0 production/revenue/security, P1 user-facing, P2 internal, P3 docs/test |
| Target date | ISO date |
| Effort | XS, S, M, L |
| Proof level | unit, integration, e2e, live-smoke, production-telemetry |
| Token/cost budget | explicit estimate or "not model-backed" |
| Blocking relation | blocked-by, blocks, related, duplicate |

## Agent-Ready Issue Contract

Every issue assigned to an agent must include:

- Business outcome
- Use case bucket
- Milestone and phase
- Problem statement
- In-scope files/behaviors
- Out-of-scope files/behaviors
- Acceptance criteria
- Proof commands
- Telemetry expected after release
- Risk tier and rollback path
- Token/cost budget or rationale for no budget

If an issue cannot answer those fields, it is not ready for an implementation agent. Keep it in Discover or Design.

## Automation Map

| Trigger | Automation | Owner |
| --- | --- | --- |
| New customer feedback or repeated support theme | Create/triage issue with use-case bucket and source link. | Linear or GitHub intake |
| Issue moves to Build and agent lane is Codex/Copilot | Start agent session from issue; branch per issue. | GitHub/Codex |
| PR opened | Add to Project, set Phase=Verify, attach linked issue, run CI. | GitHub Actions |
| CI fails | Keep item in Verify and create/update blocker comment with failing check links. | GitHub Actions |
| PR merged | Set Phase=Observe and schedule live-smoke or telemetry readback. | GitHub Actions/Railway/Plausible/Stripe |
| Token burn hotspot appears | Create operator-productivity issue for workflow review and gate candidate. | ThumbGate dashboard |
| Repeated thumbs-down cluster appears | Create agent-reliability issue with candidate PreToolUse rule. | ThumbGate RAG |

## Milestone Template

Each milestone should fit one sentence:

`By <date>, <use case> users can <measurable outcome>, proven by <metric/proof>.`

Example:

`By 2026-06-21, solo operators can see token burn and saved retry spend in the dashboard, proven by local token traces, model mix, top usage days, and chat answers grounded in /v1/dashboard.`

## Current ThumbGate Milestones

1. Exact observability: one truth path for visitors, checkout starts, paid customers, active keys, feedback totals, token burn, and blocked calls.
2. Reliability proof: aggregate feedback across stores, surface repeated failures, and convert top clusters into prevention rules.
3. Paid activation: reduce checkout confusion, instrument attribution, and prove first paid conversion path end-to-end.
4. Agent PM OS: every agent task enters through the issue contract, runs in an isolated branch/worktree, and exits with proof.
5. Enterprise pilot readiness: one regulated workflow pilot with shared lessons, dashboard evidence, export, and explicit approval boundaries.

## Review Cadence

- Daily: review P0/P1 blockers, CI failures, checkout/revenue telemetry, and agent PRs waiting for human review.
- Twice weekly: review token burn, repeated thumbs-down clusters, stale high-effort issues, and scope drift.
- Weekly: close the loop on milestones, update project views, archive stale ideas, and create one proof-backed distribution artifact.
- Monthly: evaluate tool stack, agent lanes, budget, model mix, and whether Linear is needed for intake volume.

## Anti-Patterns

- Starting an agent from a vague chat request without an issue contract.
- Using labels as a database when typed fields or project columns are available.
- Letting Linear/Jira/GitHub Projects disagree about status.
- Calling an issue done without proof commands and telemetry expectations.
- Assigning complex architecture, resource management, or security work to an agent without a human design/review gate.
- Letting agent-generated public docs include private scratchpads, internal distress, or unverifiable traction claims.
