---
"thumbgate": patch
---

ci: wire codex marketplace pack regeneration into sync-version.js

The codex marketplace pack (`docs/marketing/codex-marketplace-revenue-pack.md`)
embeds the release version in a `releases/download/v<VERSION>/` URL, but was
not a `sync-version` target — so every release tripped the
"checked-in Codex marketplace pack stays in sync with the generator output"
test (caught on 1.27.3, 1.27.4/1.27.6, would have caught every future bump).

Fix: add a `POST_SYNC_GENERATORS` step that, after the simple field-level
version sync, invokes registered regenerator scripts (currently just
`scripts/codex-marketplace-revenue-pack.js --write-docs`). On `--check` the
generators are skipped (the existing per-generator test catches drift); on a
real sync they run and re-emit the pack with the new version. Generator
failures are logged as warnings, never break the version sync — the
per-generator test is still the source of truth.

Live-verified by simulating 1.27.6 → 1.27.7: pack URL auto-updated from
`v1.27.6/...zip` to `v1.27.7/...zip` and the codex test passes 10/10.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
