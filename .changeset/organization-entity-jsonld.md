---
"thumbgate": patch
---

Add top-level `Organization` JSON-LD block to the landing page so Google's TurboQuant entity index (and AI Overviews) can recognize ThumbGate as a distinct entity with founder, logo, and canonical `sameAs` profiles (GitHub repo, npm package, founder profile). Previously the only Organization markup was embedded as `provider` inside the Workflow Sprint Service block — embedded providers are less reliable entity signals than a standalone Organization node.

Conservative `sameAs` — only verified, ThumbGate-owned URLs (no speculative social profile claims).
