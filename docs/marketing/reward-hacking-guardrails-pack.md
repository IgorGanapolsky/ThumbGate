
ThumbGate Reward Hacking Guardrails
------------------------------------
Workflow : AI coding agent release checklist
Status   : blocked
Source   : https://arxiv.org/abs/2604.13602
Signals  : 5

Signals:
  - [critical] hallucinated_verification: The response claims completion, safety, test success, or deployment without attached proof.
    Gate: Block completion claims until test output, run id, trace, screenshot, or proof artifact is attached.
  - [high] sycophancy_or_rubber_stamp: Agreement or approval language appears without independent checks or counterevidence.
    Gate: Require at least one explicit verification step or risk check before approval-style responses.
  - [high] benchmark_overfitting: A score, eval, benchmark, or reward metric is being optimized without holdout or regression proof.
    Gate: Require holdout, regression, or real-workflow evidence before treating score gains as product gains.
  - [medium] proxy_metric_only: Proxy metrics are present without an explicit human objective or user-visible success criterion.
    Gate: Pair every reward or benchmark metric with the real user outcome it is meant to approximate.
  - [high] perception_reasoning_decoupling: A visual or multimodal claim is made without source artifacts or perception trace evidence.
    Gate: Require screenshot, OCR, or visual proof artifact before accepting multimodal reasoning claims.

Required metrics:
  - unsupported_completion_claims: 0 (required)
  - evidence_attachment_rate: >= 0.95 (required)
  - unsupported_claim_rate: <= 0.02 (required)
  - holdout_regression_pass_rate: >= 0.90 (required)
  - judge_disagreement_rate: <= 0.10 (required)
  - proxy_to_user_objective_mapping_rate: >= 0.95 (required)

Next actions:
  - Attach proof artifacts before allowing claims like tests passed, fixed, deployed, safe, or ready to merge.
  - Treat benchmark gains as provisional until holdout, regression, or real-workflow evidence confirms the user objective improved.
  - Require explicit user-objective mapping for every proxy metric, reward score, or evaluator rubric.
  - Block evaluator-manipulation language before it reaches judge or verifier loops.
  - Prefer short evidence-backed summaries over long persuasive explanations when judging agent work.

Guide: Reward Hacking Guardrails for AI Coding Agents
Reply draft: This paper is a useful frame for agent products: proxy rewards compress the real user objective, and agents learn the shortcut. ThumbGate can enforce the missing layer: completion claims need proof, benchmark wins need holdouts, and verifier loops need gates against sycophancy, verbosity-as-proof, and evaluator manipulation.

