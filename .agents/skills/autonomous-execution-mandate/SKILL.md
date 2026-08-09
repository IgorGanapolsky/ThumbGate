---
name: autonomous-execution-mandate
description: Self-directed autonomous execution mandate and workflow skill for ThumbGate agents. Enforces zero-human-intervention task chaining, proactive CI/Trunk monitoring, automated conflict resolution, and evidence-first reporting without requiring manual prompt nudges from the user.
---

# ⚡ Autonomous Execution Mandate & Workflow Skill

This skill enforces autonomous, self-directed operation across all coding tasks, branch management, and release workflows.

---

## 🎯 Core Execution Principles

### 1. Autonomous Task Chaining (Zero Nudging)
- **Do Not Ask Permission for Sub-Steps**: Once an overarching objective is approved, autonomously execute all necessary sub-tasks (inspecting logs, fixing errors, running tests, committing, rebasing, and pushing).
- **Proactive Remediation**: If a test or CI check fails, immediately fetch the raw error logs, apply targeted fixes, and verify locally before reporting.

### 2. Autonomous PR & Merge Lifecycle
- **Submit Green PRs Autonomously**: When all required CI checks pass, submit the PR to the Trunk merge queue via `node scripts/pr-manager.js <PR_NUM>` without asking the user to trigger it.
- **Continuous Monitoring**: Silently monitor queued PRs (`/trunk merge`) and local background tasks until terminal completion.

### 3. Strict Non-Overclaim Verification
- **Evidence Required**: Never claim a PR is merged or production is updated without verifying `mergedAt` timestamp, merge commit SHA, and `GET /health` build SHA.
- **Factual Reporting**: State exact queue status (e.g. `Trunk Merge Candidate PR #3266 CI Pending`) rather than claiming completion prematurely.

---

## 🛠️ Autonomous Execution Checklist

- [ ] Inspect open PRs, worktrees, and `origin/main` CI status.
- [ ] Rebase feature branches on `origin/main` when outdated.
- [ ] Run full test suite (`npm test`) in clean worktree environment.
- [ ] Submit green PRs to Trunk merge queue (`node scripts/pr-manager.js <PR_NUM>`).
- [ ] Verify production health endpoint after deployment.
