---
"thumbgate": patch
---

Surface the Enterprise tier on the pricing page. The README + adapters/gcp already promise Enterprise (Vertex AI / VPC gating, regulatory gate templates, audit export, SLA) but pricing.html only showed Free/Pro/Team. Adds a full-width Enterprise contact-sales band below the three self-serve tiers (layout-safe). Copy is scoped to what ships — Vertex routing via `npx thumbgate setup-vertex` — and deliberately does not claim a live Dialogflow CX agent.
