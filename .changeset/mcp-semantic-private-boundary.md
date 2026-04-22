---
"thumbgate": patch
---

fix(mcp): lazy-load semantic and lesson-inference private boundaries

Move the remaining direct semantic-layer and lesson-inference imports in
the MCP stdio adapter behind the existing private-module loader. The
public adapter now returns the standard `private_core` availability
payload when those modules are absent instead of hard-requiring them at
module load time.

This keeps the public shell compatible with the current runtime while
making the next extraction cut safer:

1. `get_business_metrics` and `describe_semantic_entity` now route
   through the semantic-layer private boundary.
2. `context_stuff_lessons` now routes through the lesson-inference
   private boundary.
3. MCP tests pin both the loaded and unavailable paths so the public
   shell can shed these modules without breaking the adapter contract.
