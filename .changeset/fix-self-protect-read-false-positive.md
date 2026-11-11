---
"thumbgate": patch
---

Restrict `self-protect-config` and `self-protect-hooks-disable` Bash matching to actual file mutations (redirects, `sed -i`, `cp`/`mv`/`rm`/`tee`/`truncate` targeting protected paths) and `Edit`/`Write`/`MultiEdit`/`NotebookEdit` protected targets, allowing read-only commands (`ls`, `cat`, `grep`, `git diff`) and heredocs writing to unrelated files.
