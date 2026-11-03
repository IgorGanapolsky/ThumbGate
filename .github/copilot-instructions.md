# GitHub Copilot Repository Instructions for ThumbGate (October 2026)

> Always-on repository-wide instructions for GitHub Copilot Cloud Agent, GitHub Copilot Desktop App (`GitHub Copilot.app`), Copilot CLI, and GitHub Copilot Code Review.

## 1. Copilot Fusion Execution Patterns & Effort Tiering (30% Promotional Discount Through Nov 30, 2026)

- **Default Model & Orchestrator:** Always select **Copilot Fusion (`auto`)** so routing occurs along natural prompt-cache boundaries (`>99.6%` cache hit rate) and receives the **30% Copilot Fusion model cost discount** through November 30, 2026.
- **Effort Levels by Task Type:**
  - **Fusion Standard (`balance` + `qwen3.8-flash-next-local` via Local Model Auto-Routing):** Use for routine scouting, changeset files, single-file bug fixes, and CI log triage (`Single` execution pattern).
  - **Fusion High (`hydrafusion` — `Cascade` pattern):** Use for multi-file feature implementation across `src/`, `scripts/`, and `tests/` where a draft model writes the patch and a judge escalates only when needed.
  - **Fusion Max (`hydrafusion-max` — `Critique` pattern):** Use only for security gates (`scripts/gates-engine.js`), billing/Stripe checkout routes (`src/api/server.js`), and cross-repo architectural changes where parallel independent critique prevents regressions.
- **Important Copilot Fusion Caveat:** If Copilot Fusion discards an intermediate draft during `Cascade` or `Critique`, file edits written to the workspace by the discarded draft are **not** undone automatically. Always run `git diff` and `npm run verify:isolated` before committing.

## 2. Copilot Code Review Effort & Stacked PR Invariants

- **Code Review Effort Selection:**
  - **Lite (`~$0.25/review`):** Docs, changesets (`.changeset/*.md`), and<=40-line diffs.
  - **Balanced (`~$1.50/review`, default):** Standard `src/`, `scripts/`, and `tests/` PRs (41–400 lines).
  - **Max (`~$10.00/review`):** `scripts/gates-engine.js`, `src/cloud-token-firewall.js`, `src/api/server.js` billing/auth routes, and `package.json` boundary changes.
- **Stacked PR Layers:** Keep PRs small and conflict-free against `main` (`Layer 1: src/`, `Layer 2: scripts/`, `Layer 3: tests/`, `Layer 4: public/ & docs/`).
- **Changeset Requirement:** Every PR touching `src/`, `scripts/`, `bin/`, or `public/` requires a `.changeset/<slug>.md` file (`"thumbgate": patch`) so `Verify changeset` passes.
- **Git Credentials on This Mac:** Always push to `IgorGanapolsky/*` repositories using the `IgorGanapolsky` GitHub account (`git config credential.username IgorGanapolsky` or the `thumbgate_push_pr_worktree` extension tool), never `iganapolsky`.

## 3. Session Continuity (`remoteExport: true`) & Automations Safety

- Keep `"remoteExport": true` enabled so sessions move seamlessly across **GitHub Copilot.app → GitHub Mobile → GitHub.com (`github.com/copilot`) → Copilot CLI (`/resume` & `/chronicle`)**.
- Enforce AI credit limits on recurring automations (`perRun: 30`, `daily: 120`, `weekly: 500`) and least-privilege MCP tool selection.
