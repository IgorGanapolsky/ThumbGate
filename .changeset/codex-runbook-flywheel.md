---
"thumbgate": minor
---

feat(agents): steal the OpenAI Codex runbook flywheel

The OpenAI developer blog (developers.openai.com/blog/automating-repetitive-
work-at-openai-with-codex): one automation that collects context, keeps
review/approval boundaries, and improves future runs with what earlier runs
learned. Mapped onto ThumbGate:

- newRunbook()/approvePlan(): plan-before-act; execution is impossible
  until a named human approves the plan
- autoReview(): automatic approval review for bounded reversible actions
  only; consequential types (payment, deploy, delete, permission-change,
  publish, external-email) stay on the human queue without widening
  permission boundaries
- captureDecision(): decisions with choice/reason/nextTime instead of
  vanishing into chat history
- recordDeadEnd(): dead ends documented so the next run skips them
- buildIndex()/discoverContext(): the *.index.md analog — prior runs are
  discoverable and reusable by workflow name
