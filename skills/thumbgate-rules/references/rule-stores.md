# Rule & lesson stores — output reference

Detailed reference for the thumbgate-rules skill. Load only when you need field-level detail.

## `prevention_rules` MCP tool
Returns the auto-promoted prevention rules currently active for the project. Each entry typically
carries the rule text (an absolute NEVER/ALWAYS statement), the tool-call shape it gates, the
source feedback/lesson id, and its state (`active` / `archived`).

CLI fallback: `npx thumbgate rules` (add `--json` for structured output).

## `get_reliability_rules` MCP tool
Returns the reliability-layer rules — the lower-level gating of specific tool-call shapes (which
commands/arguments trip a check). Use this to explain *what pattern* a block matches when a
prevention rule's prose is high-level.

## `search_lessons` MCP tool
Full-text (FTS5) search over the promoted lesson store. Given a rule's source id or keywords,
returns the lesson that produced it — the original mistake, the context, and the fix. Use it to
fill the "From lesson" column so the user understands the rule's provenance.

## Mapping rules → lessons
1. A repeated `down` capture becomes a lesson in the FTS5 store.
2. The auto-promotion (or `force-gate`) turns that lesson into a prevention rule + reliability gate.
3. `prevention_rules` shows the rule; `search_lessons` retrieves the lesson it came from.

So a complete answer pairs each row from `prevention_rules` / `get_reliability_rules` with its
`search_lessons` origin. Never present a rule without being able to say where it came from.

## Empty-store behavior
If all three return nothing, the project simply has no promoted rules yet. Do not fabricate
examples — point the user to the thumbgate-guard skill (or `npx thumbgate quickstart`) to create
the first one.
