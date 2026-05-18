---
"thumbgate": patch
---

Ship two new public pages from competitive-intel on the Rein governance project (LinkedIn post by @jnwhampton, 2026-05-15):

- `/compare/rein` — honest side-by-side. Both projects intercept agent actions before they fire; that's the shared category. The differences: integration layer (decorator vs PreToolUse hook), target user (production app agents in regulated domains vs AI coding agents), license (AGPL vs MIT), and learning loop (Rein has policy authoring; ThumbGate has thumbs-down → auto-promoted prevention rule). Not framed as "we win" — Rein is well-designed software, picks differ by stack.

- `/learn/ai-agent-governance` — claim the SEO term Rein is targeting by defining the four-layer pattern (prompt rules / decorator wrappers / pre-action hooks / sandbox isolation) and positioning ThumbGate at layer 3. The page is layer-agnostic; it explicitly tells readers to pick Rein at layer 2 if Rein's profile matches their stack.

Also wires both pages into `/compare` index card layout and adds them to the `tests/learn-hub.test.js` valid-internal-paths allowlist alongside `/learn/spec-driven-development` (the previous PR that was missed in that allowlist).
