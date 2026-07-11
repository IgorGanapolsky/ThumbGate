---
"thumbgate": patch
---

fix(plugin): ship a hooks lifecycle in the plugin manifest so fresh plugin/desktop-extension installs actually run PreToolUse enforcement, recall, and the session primer (previously only skills/commands/mcpServers were wired).
