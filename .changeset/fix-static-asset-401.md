---
"thumbgate": patch
---

Fix: serve public static assets (`/assets/*`, `/favicon.ico`, `/thumbgate-logo.png`, `/og.png`, `/apple-touch-icon.png`) without requiring an API key. Before this change the landing page rendered but every image, video, and icon fell through to the `/v1/*` API-key guard and returned 401, leaving visitors with an empty video player and broken poster images. Adds path-traversal-safe asset routing with correct MIME types, `Cache-Control: public, max-age=86400, immutable`, and HEAD-request support. Covered by `tests/public-static-assets.test.js`.
