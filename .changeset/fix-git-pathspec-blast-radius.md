---
"thumbgate": patch
---

Scope `git add` / `git commit` blast radius to the command's pathspec

`extractAffectedFiles()` derived the affected-file set for `git add` by scanning the entire
working tree (`git diff --name-only` plus all untracked files), ignoring the pathspec the
command actually declared. In a repo with a large dirty tree — a checkout shared by several
agents, for example — a correctly scoped `git add -- src/a.js src/b.js` was reported as
thousands of affected files, so `task-scope-required` and `protected-file-approval-required`
blocked commits that never left their declared scope.

The pathspec now defines the scope: an explicit file list reports exactly those files, a
directory pathspec reports the dirty files beneath it, and only a genuinely broad add
(`git add .`, `-A`, `-u`, no pathspec, or an unexpandable glob/variable) falls back to the
full tree scan. `git commit` narrows the same way when an explicit `-- <pathspec>` is given.

Also caps the file list serialized into the memory-guard match input, so guard matching keys
on the action rather than on the size of the checkout.
