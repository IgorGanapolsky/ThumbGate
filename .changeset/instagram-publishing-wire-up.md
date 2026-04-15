---
"thumbgate": patch
---

Fix Instagram publishing end-to-end. `post-video.js` now uses the Zernio presign upload flow + shared `publishPost`, matching the `{ url, key, size, contentType, type }` media-item shape Instagram requires (legacy `/media` multipart + minimal `{ url, type }` payload was silently rejected). Added `instagram` dispatcher to `post-everywhere.js` (previously a silent no-op). Added daily `instagram-autopilot.yml` workflow that posts a ThumbGate card via `publish-instagram-thumbgate.js`.
