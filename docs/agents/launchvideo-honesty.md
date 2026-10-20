# LaunchVideo.io Deterministic Film Honesty (FORMAT Steal)

Sources:
- [LaunchVideo.io](https://launchvideo.io/)
- [`diggerhq/shipvideo`](https://github.com/diggerhq/shipvideo)

## Architectural Ideas Stolen into `scripts/cli-demo.js`

1. **No Video Diffusion Model — Deterministic Virtual Clock (`buildVirtualClockTimeline`, `seekVirtualClockFrame`)**
   - Instead of calling a video diffusion model, the LLM writes the film as HTML/CSS/JS.
   - The renderer replaces `requestAnimationFrame`, `setTimeout`, `setInterval`, `Date.now`, `performance.now`, CSS Animations, and Web Animations with a deterministic virtual clock (`virtualTimeMs = (frameIndex / 30) * 1000`), seeking `1920x1080` @ `30fps` JPEG frames directly into `ffmpeg -c:v libx264 -crf 18 -pix_fmt yuv420p`.

2. **Minimal 3-Tool Director Pipeline (`extractBrandTokensFromHtml`, `checkSceneGate`)**
   - `web_fetch` (`extractBrandTokensFromHtml`): extracts `title`, `headings`, top hex colors (`#rrggbb` sorted by frequency), and Google Fonts from a product site in one pass.
   - `check_scene` (`checkSceneGate`): loads the HTML scene in headless Chromium before encoding and reports JS runtime errors plus visible text at sample timestamps (`t = 0s, 5s, 10s, ...`). Blocks `render_video` if any JS error fires or any sample timestamp renders blank text.

3. **Zero-Secret Scoped Upload Manifest (`mintScopedBlobUploadManifest`)**
   - The rendering agent holds **no storage master secrets** (`agentHoldsMasterSecret: false`; fails closed if `BLOB_READ_WRITE_TOKEN` or `AWS_SECRET_ACCESS_KEY` is present in the agent environment).
   - Mints a per-job manifest scoped to a single output path (`jobs/<jobId>/launch.mp4`) with a maximum 3-hour TTL (`10800s`).

4. **MP4-in-Blob Completion Gate (`verifyMp4ArtifactCompletion`)**
   - Watching `tool.started`, `tool.completed`, and `turn.completed` shows progress, but a job is marked `done: true` **only** when the rendered `.mp4` artifact exists in Blob storage with `sizeBytes > 0`.

## CLI Usage

```bash
npx thumbgate launchvideo-honesty --json
npx thumbgate launchvideo-honesty --map-only --json
```
