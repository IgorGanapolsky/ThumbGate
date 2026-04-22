---
"thumbgate": minor
---

Migrate canonical public origin from `thumbgate-production.up.railway.app` to `thumbgate.ai`.

- Register `thumbgate.ai` and `www.thumbgate.ai` as canonical public hosts; configure `usethumbgate.com` and `www.usethumbgate.com` as purchased aliases that 308-redirect to the canonical host with path/query preserved.
- Update `package.json` homepage, Railway workflow defaults, marketing copy, README buyer-question links, `public/llm-context.md` manifest URLs, SEO canonicals, and test assertions to `thumbgate.ai`.
- Add unit + integration tests pinning `normalizePublicHostHeader`, `buildCanonicalMarketingRedirect`, and the 308 alias-host redirect behavior served by the API.
