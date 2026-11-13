---
"thumbgate": patch
---

Upgrade ThumbGate's layout and accessibility pipeline from passive diagnostic warnings into an active, AST-backed self-correcting design engine (`src/design-self-correction-engine.js`, `POST /v1/design/self-correct`, and `thumbgate design-fix`) that generates exact CSS override properties, Tailwind utility adjustments, and hash-anchored inline code edits.
