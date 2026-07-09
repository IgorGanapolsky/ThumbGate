---
"thumbgate": minor
---

Detect an explicit "never …" / "always …" directive in feedback and surface the one-shot enforcement path as an offer. When a thumbs-down says "never do X", the capture confirmation now offers an immediate `force-gate` (block now) instead of silently waiting for the pattern to recur — because typing "never" is explicit intent to guard. It only OFFERS; it never auto-blocks (auto-promotion stays occurrence-gated, which is what keeps a single signal from locking you out). A thumbs-up "always …" is clarified as guidance-only (positive patterns are surfaced as context, not gate-enforced). New `scripts/imperative-detector.js` (pure/deterministic) + wired into the CLI feedback confirmation.
