---
"thumbgate": patch
---

Add an ABSOLUTE directive to `CLAUDE.md`, `AGENTS.md`, and `GEMINI.md`: never approve a pull request, never satisfy or dismiss a branch-protection requirement on the owner's behalf, never use `--admin`/`--force`/owner credentials to make a blocked merge possible. Everything merges through PRs reviewed by a human; a blocked PR is a finding to report, not an obstacle to clear. `AGENTS.md`'s autonomy directive ("never leave a PR open when it can be merged") is now explicitly bounded by this limit, since that instruction combined with owner credentials is what produced the 2026-07-10 incident: an agent approved PR #2768 as the code owner to satisfy `require_code_owner_reviews` and watched the gate flip `BLOCKED → CLEAN`. `tests/never-bypass-branch-protection.test.js` pins the directive in all three files so it cannot be quietly deleted.
