---
"thumbgate": patch
---

Fix: natural Workflow Hardening Sprint URLs (`/sprint`, `/workflow-hardening`, `/workflow-hardening-sprint`, `/workflow-sprint`, and `.html` variants) now 302-redirect to the canonical `/#workflow-sprint-intake` anchor instead of returning a hostile JSON 401 (`urn:thumbgate:error:unauthorized`).

Recipients of outbound messages mentioning "the workflow hardening sprint" who typed the natural URL were being silently bounced. Live probe on 2026-05-18 confirmed the 401 response on all four URL variants on production.

Mirrors the existing `/services` → `/#workflow-sprint-intake` redirect pattern. 8 new redirect assertions added to `tests/public-static-assets.test.js`.
