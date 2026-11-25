---
"thumbgate": patch
---

Copy-paste setup examples (adapters, plugin install docs, the install page commands, MCP hub submission) now run `thumbgate@latest` instead of the release pin, so a config copied today keeps following npm. `sync-version` rewrites any release pin that creeps back in; the install page's version labels still name the current release.
