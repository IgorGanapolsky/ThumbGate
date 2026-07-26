---
"thumbgate": patch
---

Stop the memory guard matching on its own serialization keys

`evaluateCompiledGuards` / `evaluatePretoolFromState` matched guard keywords as raw
substrings against a JSON-serialized envelope — `{"toolName":…,"command":…,"filePath":…,
"affectedFiles":[…]}`. The envelope's own KEY NAMES were therefore part of the haystack on
every evaluation, so the tokens `files`, `command`, `tool`, `name` and `path` were always
present. With a two-hit block threshold, any guard whose keyword list contained two such
common words blocked **every** action, regardless of what that action was.

Three changes:

- Match against the VALUES only. Key names can no longer contribute a hit, and the callers
  that pass a raw object (`context-manager`) or a plain command string are handled uniformly.
- Match whole words instead of raw substrings, so `app` no longer hits `apps/`,
  `application` or `happen`. Boundaries are non-alphanumeric, so `src/jobs/queue.js` still
  matches the word `jobs`.
- Weight by specificity: one long or compound token (`generated-cache`) is sufficient
  evidence on its own, while generic short words still require corroboration. This keeps
  exact-command-repeat detection working now that structural free hits are gone.

Verified on a clean checkout: a guard built from generic words previously blocked `ls -la`
and `curl 127.0.0.1:9333/json/version` unconditionally; both are now allowed, while a real
recurring destructive pattern still blocks.
