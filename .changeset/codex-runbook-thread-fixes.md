---
"thumbgate": patch
---

fix(codex-runbook): resolve CodeRabbit review threads on runbook flywheel

- Implement --dry-run and --solve CLI modes in main() via parseCliArgs()
- Normalize plan steps to stable identifiers via stepId() helper; executeStep
  matches by id instead of object reference
- Validate runbook state before allowing closeRunbook()
- Store full decision/dead-end records in buildIndex/index and return
  matching records from discoverContext()
