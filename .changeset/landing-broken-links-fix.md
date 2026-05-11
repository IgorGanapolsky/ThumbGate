---
"thumbgate": patch
---

Fix three broken navigation paths on the homepage: the ThumbGate logo link (`href="#"` → `/`), the header "Install Free" button (was pointing at the ChatGPT GPT redirect; now points at the actual install flow), and the hero + final "Install Free CLI" buttons (now copy `npx thumbgate init` to clipboard inline with visible "Copied ✓" feedback, instead of redirecting to `/guide` where buyers perceive "nothing happened").
