---
"thumbgate": patch
---

Fix Playwright E2E: `dashboard-page-clickability` expected `'Gemini API key configured'` but the Perplexity-hybrid dashboard reworded the success banner to `'✓ Key validated. Hybrid (Perplexity/Gemini) supported for chat with your data.'` Test now matches the stable `'Key validated'` substring (with fallback to the old copy) so future banner tweaks don't break it. Unblocks PR #2463 + #2464 from the pre-existing E2E failure on main.
