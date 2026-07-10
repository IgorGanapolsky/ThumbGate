---
"thumbgate": patch
---

Add an absolute directive to `CLAUDE.md`, `AGENTS.md`, and `GEMINI.md`: never approve a pull request, mutate review or protection state, or use `--admin`/`--force`/owner credentials to make a blocked merge possible. The policy preserves non-mutating diagnosis and separate policy-change PRs while pinning the verified 2026-07-10 incident in which an agent used owner credentials to approve #2768. `tests/never-bypass-branch-protection.test.js` prevents the directive from being quietly deleted.
