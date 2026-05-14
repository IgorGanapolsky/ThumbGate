---
"thumbgate": patch
---

Consolidate Python feedback classification into `scripts/feedback_categories.py`. The trainer and eval scripts now share `DEFAULT_CATEGORIES`, `resolve_feedback_dir`, and `classify_entry` (regex word-boundary matching with adapter-shape field-name aliases for `lastAction` / `last_action` / `toolName` / `tool_name` / `last_tool`). Kills three classes of silent classification bugs: substring false positives ("credit"→edit), category drift between trainer and eval, and dropped tool-name signal on canonical `capture-feedback.js` entries.
