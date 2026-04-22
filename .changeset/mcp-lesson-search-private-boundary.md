---
"thumbgate": patch
---

fix(mcp): lazy-load lesson search private boundary

Move the remaining direct lesson-search import in the MCP stdio adapter
behind the private module loader. This keeps the hosted/private runtime
behavior unchanged while letting the public shell return the standard
`private_core` availability payload if lesson search is extracted out of
the public package.

This pins the boundary in two ways:

1. `search_lessons` now resolves through the MCP private-module loader.
2. MCP tests cover the unavailable-module path for lesson search along
   with the existing private-core tool matrix.
