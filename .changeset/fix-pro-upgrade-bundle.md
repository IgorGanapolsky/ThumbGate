---
"thumbgate": patch
---

Fix `thumbgate pro --upgrade` in the public npm package by shipping the local Pro upgrade bundle from `config/pro` and adding a clear missing-bundle error instead of referencing an unpublished top-level `pro/` subtree.
