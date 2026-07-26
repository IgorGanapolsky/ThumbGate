---
"thumbgate": patch
---

Fix five pathspec resolution defects found in review

Raised on PR #3036 by two independent reviewers (`chatgpt-codex-connector` and
`greptile-apps`, the latter running executable repros against real git). All five were real,
all introduced by the pathspec-scoping work in this same PR, and each produced **wrong gate
decisions** rather than merely wrong reporting.

1. **Pathspec resolved against the repo root instead of the shell's working directory.**
   With `cwd=/repo/src`, `git add a.js` stages `src/a.js` but was reported as `a.js`, so
   task-scope and protected-file gates evaluated a path that does not exist — a protected
   `src/a.js` change could pass. A leading `cd` chain is now followed too, since
   `cd src && git add a.js` is the common shape.

2. **Git pathspec magic treated as a literal filename.** Per `gitglossary(7)`, an
   exclude-only pathspec applies as though no pathspec were supplied, so
   `git add ':(exclude)root.txt'` stages *everything else*. Parsing it as the literal string
   `:(exclude)root.txt` let exclude, `top` and `icase` magic evade scope checks entirely.
   Any `:`-prefixed token now falls back to the conservative broad scope.

3. **Backslash-escaped paths split into fictional tokens.** `git add my\ dir/file.js` split
   at the escaped space, so the gates evaluated two paths git never touches. The tokenizer
   now honours backslash escapes outside single quotes.

4. **`git commit -- <pathspec>` missed working-tree files.** Git commits tracked files with
   unstaged modifications directly from the working tree; filtering only the cached diff
   dropped exactly those files from enforcement. The candidate set for a pathspec-scoped
   commit now includes unstaged tracked modifications.

5. **The memory-guard file cap discarded action targets.** Truncating to the first 25
   affected files meant a recurring-negative guard whose keywords appear only in a later
   filename could no longer match, making a learned prevention rule bypassable purely by
   filename ordering. The false positives that motivated the cap came from the JSON
   envelope's key names polluting the haystack, which is fixed at the matcher instead — so
   the cap was both unnecessary and harmful. Replaced with a generous character bound that
   discards no targets.

Adds five regression tests reproducing each reported scenario.
