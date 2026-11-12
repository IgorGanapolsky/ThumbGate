---
"thumbgate": patch
---

Gate Google and Apple SSO buttons on configured OAuth client IDs, add `/v1/cloud/sso/callback` Google OIDC verification, persist auth sessions across redeploys, and fix dashboard Log Out to await session deletion and navigate to `/dashboard?noauto=1`.
