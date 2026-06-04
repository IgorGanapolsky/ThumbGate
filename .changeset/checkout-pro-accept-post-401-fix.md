---
"thumbgate": patch
---

Fix /checkout/pro 401 leak: extend route guard to accept POST in addition to GET/HEAD so prospective customers whose forms or fetch() calls land via POST no longer hit the API-key auth gate. Plausible audit (2026-06-04) showed 270 "Checkout Pro Viewed" → 69 "Email Submitted" → 0 paid because POST returned HTTP 401 to every non-API-key visitor. Query params still drive Stripe session creation; POST bodies are ignored harmlessly.

Also ship a public /about page with schema.org/Person JSON-LD and sameAs links (GitHub, LinkedIn, dev.to, Upwork, Hugging Face, X) to close the LLM-discoverability gap identified in the 2026-06-04 GEO audit — thumbgate.ai has crawl authority but Igor was previously footer-only on his own primary domain.
