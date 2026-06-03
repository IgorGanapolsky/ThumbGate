---
"thumbgate": patch
---

Two pre-action gate fixes that were unblocking legitimate coding-agent work:

1. **memory-high-risk gate exempts credential-hardening chmod** — `chmod 600` on a credential path (e.g. `~/.resume_secrets/key.json`, `~/.ssh/id_*`) is a hardening (safety) action. It was being hard-denied by `memory-high-risk-default-deny` when recurring negative memory matched. The `isSafeLocalCredentialHardeningCommand` exemption (already guarding the permission-change-approval gate) now also guards the memory gate.

2. **task-scope rebases absolute allowedPaths to repo-relative** — affected files are compared repo-relative, so an absolute `allowedPath` silently never matched (no-op scope). `setTaskScope` now rebases absolute globs under `repoPath` to their repo-relative form; the repoPath itself collapses to `**`. Relative globs and globs outside repoPath are unchanged (monotonic — can't regress a working scope).
