---
"thumbgate": patch
---

test(boundary): add public-core-boundary regression test

CLAUDE.md / AGENTS.md / GEMINI.md mandate a regression test at
`tests/public-core-boundary.test.js` to pin fixes that preserve the
Product Architecture Split. Until now this file did not exist on main,
so each "split complete" claim was unverifiable.

The test asserts three directive-codified violation triggers:

1. No packaged JS/TS file imports `thumbgate-core`, `@thumbgate/core`,
   or `../ThumbGate-Core`. Public code must talk to Core over a wire
   protocol, never direct `require`.
2. `package.json` does not list Core in `dependencies`,
   `peerDependencies`, or `optionalDependencies`.
3. The npm bundle file count stays below a ceiling (260 currently, with
   ~50-file headroom over today's 212) to catch silent re-expansion.

All three pass against the current public shell. This test is the
canonical home for future boundary fixes.
