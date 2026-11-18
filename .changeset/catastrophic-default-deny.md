---
"thumbgate": patch
---

A default install now denies force-push, `git reset --hard`, `git clean -f`, `rm -rf` on home or root, and `DROP TABLE`, the way it already denied secret exfiltration. These five gates join the unconditional hard floor. Warning text no longer says "blocked" when the action runs.
