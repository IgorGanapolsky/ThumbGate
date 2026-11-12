---
"thumbgate": patch
---

Extend `workflow-sentinel` destructive-delete detection (`destructive_delete`, warn by default) to cover `find ... -delete`, `find ... -exec rm`, Windows `rmdir /s` / `del /s` / `rd /s`, PowerShell `Remove-Item -Recurse`, `git clean -fdx`, and delete commands targeting unset or empty variables (`$T`, `${T}`, `"$T/"`), plus Codex/Windows shell tool-name and argv canonicalization in `gate_check`.
