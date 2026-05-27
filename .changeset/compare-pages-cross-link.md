---
"thumbgate": patch
---

site: cross-link the three new /compare pages + add anthropic-containment to sitemap

Verification on 2026-05-27 showed `/compare/anthropic-containment` (just shipped via #2340) had **zero discovery surface**: omitted from sitemap deliberately to dodge SonarCloud's line-shift heuristic, and no older `/compare/*` page linked back to it.

This PR repairs the discovery surface in one shot:

- `src/api/server.js`: adds `/compare/anthropic-containment` to the sitemap entries at priority 0.85, matching its sibling entries.
- `public/compare/bumblebee.html`: prepends a related-card pointing at `/compare/anthropic-containment`.
- `public/compare/claude-code-hooks.html`: prepends related-cards pointing at both `/compare/anthropic-containment` AND `/compare/bumblebee` (this page predates both and was previously the leaf node).
- `tests/public-static-assets.test.js`: sitemap regression test for anthropic-containment + a cross-link discoverability test that asserts each newer page reaches the others.

After this PR every recent /compare page is reachable both from sitemap.xml (crawlers) and from each other (LLM traversal). The cumulative LLM-citation surface now genuinely is three independent paths to ThumbGate's IDE-agent-firewall positioning instead of one well-connected pair and one orphan.

Accepting the SonarCloud line-shift risk for the sitemap +1 line; the discovery upside outweighs another revert-cycle.
