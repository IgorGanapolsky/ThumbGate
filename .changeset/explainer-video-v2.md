---
"thumbgate": patch
---

Replace the landing-page explainer video with a reproducible 90-second animated
walkthrough that actually explains the mechanism — same-mistake-different-session
pain, 👎 → Pre-Action Gate extraction, gate fires on the next bad call,
compounding token savings, one-line install. Adds an offline render pipeline
(`scripts/render-demo-video/`) that drives a scripted 1920×1080 HTML animation
through headless Playwright and muxes an ElevenLabs/`say` narration track —
byte-reproducible on every re-render, no live agent session required. New
npm scripts: `demo:narration`, `demo:render`, `demo:render:full`.
