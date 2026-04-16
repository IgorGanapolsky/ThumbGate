---
thumbgate: patch
---

Include `public/dashboard.html`, `scripts/prompt-eval.js`, and `bench/prompt-eval-suite.json` in the published npm package. The 1.5.1 release shipped without `dashboard.html`, breaking the local Pro dashboard for users who ran `npx thumbgate pro`. This patch restores the dashboard and ships the prompt evaluation framework.
