
ThumbGate Proactive Agent Eval Guardrails
-------------------------------------------
Workflow : proactive assistant shipping checklist
Status   : blocked
Source   : https://arxiv.org/abs/2604.00842
Signals  : 6

Signals:
  - [high] flat_tool_api_gap: Flat tool APIs miss stateful navigation and state-dependent action spaces.
    Gate: Require finite-state app model before proactive execution.
  - [high] missing_active_user_simulation: Proactive agents need simulated user progress before timing can be evaluated.
    Gate: Run active user simulation before enabling anticipatory actions.
  - [medium] missing_goal_inference_eval: The agent may intervene without evidence that it inferred the user goal correctly.
    Gate: Grade goal inference before intervention approval.
  - [high] missing_intervention_timing_eval: A helpful action at the wrong time becomes interruption or damage.
    Gate: Require too-early, on-time, and too-late timing eval cases.
  - [critical] multi_app_write_risk: Multi-app proactive writes can compound state mistakes across tools.
    Gate: Block multi-app proactive writes until orchestration evals and rollback evidence exist.
  - [high] user_visible_interruption_risk: User-visible interventions need timing proof before notification, scheduling, or communication actions.
    Gate: Require intervention timing proof before user-visible actions.

Required metrics:
  - goal_inference_accuracy: >= 0.85 (required)
  - intervention_timing_f1: >= 0.80 (required)
  - false_intervention_rate: <= 0.05 (required)
  - state_transition_validity: >= 0.98 (required)
  - multi_app_orchestration_success: >= 0.85 (required)

Next actions:
  - Model each app as states, allowed actions, and valid transitions before judging proactive behavior.
  - Add active user simulation cases where the user keeps navigating while the agent observes.
  - Evaluate goal inference separately from intervention timing so a correct goal at the wrong time is still caught.
  - Block proactive writes across multiple apps until orchestration success and rollback evidence are measured.
  - Attach the eval report to any claim that a proactive agent is production-ready.

Reply draft: This is the missing eval shape for proactive agents. Flat tool calls cannot tell whether the agent acted at the right state or the right time. ThumbGate can use this pattern as the enforcement layer: stateful eval failure -> pre-action gate before the next proactive write.

