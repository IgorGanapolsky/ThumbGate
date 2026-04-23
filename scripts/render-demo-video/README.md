# Explainer-video renderer

Offline, reproducible pipeline that turns
[`docs/marketing/demo-video-script.md`](../../docs/marketing/demo-video-script.md)
plus [`index.html`](./index.html) into
`public/assets/tiktok-agent-memory.mp4` — the 90-second explainer that ships on
the landing page and social channels.

## What it renders

1. A 1920×1080 HTML animation (5 scenes, 90 s total timeline) — no live agent,
   no real editor, no screen recording. Everything is typed into a
   `<pre>`-based terminal via a deterministic JS timeline, so the output is
   byte-identical on re-render (modulo TTS provider).
2. A narration track built from the canonical demo-video-script markdown:
   ElevenLabs Rachel when `ELEVENLABS_API_KEY` is set, otherwise macOS `say`
   (Samantha, 170 wpm) as a cost-free fallback.

Scene boundaries (must match `index.html` + `generate-narration.js`):

| Scene | Starts | Ends | Narrative job |
|-------|--------|------|---------------|
| 1 — The problem            | 0 s  | 15 s | Same failure, different session, paid tokens both times |
| 2 — The idea               | 15 s | 30 s | A 👎 becomes a Pre-Action Check |
| 3 — The gate fires         | 30 s | 55 s | Gate intercepts bad call before the model round-trip |
| 4 — Why it compounds       | 55 s | 75 s | Dashboard, token savings, quiet-gate retirement |
| 5 — Install                | 75 s | 90 s | `npx thumbgate init` CTA |

## One-shot re-render

```bash
# 1. Regenerate narration (uses ELEVENLABS_API_KEY if present, else `say`)
npm run demo:narration

# 2. Render HTML → webm → H.264 mp4, mux with narration.mp3
npm run demo:render

# Or run both in sequence:
npm run demo:render:full
```

Output lands at `public/assets/tiktok-agent-memory.mp4`. Override the
destination with `--out=path/relative/to/repo.mp4`.

## Dependencies

- `playwright-core` (already in `package.json`)
- `ffmpeg` + `ffprobe` on PATH (Homebrew: `brew install ffmpeg`)
- For fallback TTS: macOS `say` (built in). Otherwise set
  `ELEVENLABS_API_KEY` and optionally `ELEVENLABS_VOICE_ID`.

## Why not screen-record a real Claude Code session?

Because real sessions are non-deterministic, contain PII, change minute-to-minute
with model updates, and cost tokens every time marketing wants a re-cut. A
scripted HTML animation is versioned, diffable, and free to regenerate — which
is exactly the property ThumbGate itself preaches.

## Files

- `index.html` — the 1920×1080 animated page. Timing lives in the `<script>`
  at the bottom; edit there, not in render.js.
- `render.js` — Playwright headless runner that records the viewport for 90 s,
  transcodes to H.264 yuv420p 30 fps, and muxes `narration.mp3` if present.
- `generate-narration.js` — extracts the per-scene voiceover blocks from
  `docs/marketing/demo-video-script.md`, synthesizes each one, pads each clip
  with silence to hit the next scene boundary, concatenates.
- `narration.mp3` — generated artifact, git-ignored. Regenerate with
  `npm run demo:narration`.
