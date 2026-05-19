---
"thumbgate": minor
---

Automate post-deploy verification of top-level marketing pages.

The existing `.github/workflows/deploy-verify.yml` already checks `/health` version and `/dashboard` after every push to main, plus sample-curls any `public/learn|guides|compare/*.html` route added in the diff. Top-level marketing pages — `/`, `/pro`, `/federal`, `/numbers`, `/llm-context.md`, `/robots.txt`, `/sitemap.xml` — had no automated coverage; a deploy that 500'd or returned blank HTML on those routes would only be caught by a real visitor.

This PR closes that gap with three additive surfaces:

1. **`config/post-deploy-marketing-pages.json`** — sentinel manifest. Each entry pairs a route with a stable body-copy sentinel string. Adding a new top-level marketing page = appending to JSON, no workflow edit required.

2. **`scripts/verify-marketing-pages-deployed.js`** — config-driven probe. Curls each manifest entry against `https://thumbgate-production.up.railway.app` (overridable via `THUMBGATE_PROD_URL` env or `--prod-url=…`), asserts sentinel present in response body. Exit 0 on full pass, 1 on any miss. Human or `--json` output. Browser-shaped UA so bot-deflection interstitials don't trigger false positives.

3. **`.github/workflows/deploy-verify.yml`** — new step `Verify top-level marketing pages still match sentinels` after the existing `/dashboard` check. The success and failure PR comments now surface "**N/M** top-level marketing pages match their sentinel manifest" or the failure detail.

Verified locally: probe runs against current production returns **8/8 pages PASS**. 16 unit tests at **87.69% line coverage**, **89.58% branch coverage** on the probe script — comfortably above SonarCloud's 80% gate.

Ratchet ceilings bumped 254 → 256 (both `tests/public-bundle-ratchet.test.js` and `tests/package-boundary.test.js`) for the probe script + manifest JSON. The probe ships in the public npm bundle so external operators self-hosting ThumbGate get the same regression guard against their own deployment.
