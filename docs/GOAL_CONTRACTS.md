# Goal Contracts

Goal contracts make multi-agent work auditable before any agent claims a task is done. They are meant for Cline-style SDK agents, Genkit middleware, Hermes/Kanban handoffs, local Telegram operators, and deployment plugins that can act quickly but still need proof before closing a task.

Use `require_evidence_for_claim` with `goalContract` when an orchestrator delegates work to one or more agents:

```json
{
  "claim": "ready for handoff",
  "goalContract": {
    "goal": "Ship the checkout fix",
    "doneWhen": [
      "Focused tests pass",
      "Independent review is complete",
      "Deployment is verified"
    ],
    "proveBy": ["tests_passed", "review_completed", "deploy_verified"],
    "mustNotChange": ["Stripe product ids", "public package exports"],
    "workerAgent": "codex-worker",
    "reviewerAgent": "codex-reviewer",
    "orchestratorAgent": "leader-agent"
  }
}
```

The gate blocks until every `proveBy` action has been recorded with `track_action`. This keeps the expensive part of modern agent systems honest: fast workers can continue to build, but the orchestrator cannot say "done", "fixed", "shipped", or "ready" until the evidence exists.

Recommended action ids:

- `tests_passed` for focused local verification
- `review_completed` for independent reviewer signoff
- `ci_green` for remote CI
- `deploy_verified` for live deployment checks
- `operator_approved` for irreversible public writes or credentialed actions
- `workflow_step_replayed` for durable workflow recovery checks
- `workflow_trace_reviewed` for step-level production debugging evidence

This is intentionally framework-neutral. Genkit middleware, Cline SDK plugins, MCP clients, Hermes agents, local Ollama agents, and deploy plugins should all call the same ThumbGate contract instead of each inventing a separate completion policy.

For Cloudflare Workflows V2-style runners, map each durable step to a `track_action` event only after the step has completed or replayed successfully. Keep human approval waits outside the claim path until `operator_approved` is tracked. This lets high-concurrency agent workflows fan out safely while preserving one completion contract at the end.
