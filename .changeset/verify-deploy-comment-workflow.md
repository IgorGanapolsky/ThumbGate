---
"thumbgate": patch
---

Add `.github/workflows/verify-deploy-comment.yml` which runs after the `Deploy to Railway` workflow finishes for `main` pushes. It polls `/health` for up to 8 minutes waiting for the production `buildSha` to match the merge commit, probes `/`, `/health`, `/dashboard`, and every newly added `public/learn/*.html` or `public/guides/*.html` route in the merge diff, then posts a single comment back on the PR that introduced the merge — with the buildSha match, the `/health` JSON snapshot, and the per-route HTTP codes. Codifies the CLAUDE.md deployment-verification gate (no claiming "deployed" without `/health` evidence) as automation rather than a human checklist.
