# GEO: AI Overview eligibility (2026-06-05)

Trigger: CEO shared Google's "Search Generative AI performance reports in Search Console"
(2026-06-03) and asked "how does this help us? implement the high-ROI ideas."

## What the blog actually says (VERIFIED via WebSearch across Google + SE Land + SEJ)
GSC now reports **impressions inside AI Overviews, AI Mode, and Discover AI features**,
sliced by Pages/Countries/Devices/Dates. Impressions only (no clicks/queries yet),
rolling out to a subset (UK first). It also ships an opt-out to *block* content from AI answers.

How it helps: it's the first way to **measure** whether ThumbGate appears in Google's AI
answers — the core GEO goal. Two implementables fall out: (1) don't block AI crawlers,
(2) be structurally eligible + crawlable for AI Overviews on category/comparison queries.

## What I found (audit, not assumption)
- robots.txt already explicitly `Allow: /` for Google-Extended, GPTBot, OAI-SearchBot,
  ClaudeBot/Claude-SearchBot/Claude-User, PerplexityBot, anthropic-ai, Googlebot, Bingbot,
  + llms.txt/llm-context.md + Sitemap. **No gap — left untouched.**
- Homepage structured data already rich (FAQPage 12 Q, HowTo, 2× SoftwareApplication).
- REAL gaps:
  - `compare/rein.html` and `agent-manager.html` had **no FAQPage schema** → ineligible
    for AI Overviews on their queries.
  - **4 comparison pages missing from /sitemap.xml**: agentix-labs,
    ai-experience-orchestration, heidi, rein. (Corrected from an initial wrong "7 missing"
    — fallow/mem0/speclock are already covered via seo-gsd.js. The "are you sure?" check
    caught that I'd only read the hardcoded list, not the spread-in seo entries.)

## Decisions
- **Root-cause fix, not a patch.** Instead of hand-adding the 4 missing entries,
  `renderSitemapXml` now derives compare entries from `fs.readdirSync(PUBLIC_DIR/compare)`
  and de-dupes against entries already declared (so seo-gsd's explicit priorities win).
  New compare pages are now auto-included forever. Kept the 6 hardcoded entries (preserve
  the 0.9 priority on anthropic-claude-for-legal; FS-derive skips them via the dedupe set).
  - Tradeoff: one `readdirSync` per /sitemap.xml request. Negligible (low-traffic crawler
    route; server already reads files per marketing page). Wrapped in try/catch so a
    stripped bundle without public/compare falls back to static entries. Files sorted for
    deterministic output.
- **FAQ content is grounded in each page's real copy**, not filler — and preserves the
  honest license hedge on rein.html (Rein's exact license to be verified at reinai.io;
  secondary source said AGPL, unconfirmed). VERIFIED by reading both pages before writing.
- **Regression guard** added: `public-static-assets.test.js` asserts every
  public/compare/*.html is in /sitemap.xml, + that rein/agent-manager expose FAQPage.
  This is the durable anti-drift mechanism (CEO: "no tech debt").

## Verification (all VERIFIED)
- public-static-assets.test.js: 62 pass (incl. 2 new guards)
- api-server.test.js: 136 pass
- seo-gsd.test.js: 28 pass
- package-boundary + public-bundle-ratchet: 6 pass (file count 254 unchanged — no new
  bundle files; HTML edits only add content). Size cap has headroom.
- JSON-LD in both edited pages parses; 4 FAQ questions each.
- Changeset added (patch).

## NOT done / out of scope
- Reading the live GSC gen-AI report for thumbgate.ai — rolling out UK-first/subset, may
  not be available for our property yet; needs GSC browser access, not a code change.
- #2511 (chat answerer) is owned by another active session (commits 3 min ago in
  /tmp/tg-chat2); its duplicate-key S1534 bug was already removed in their latest commit.
  I stood down — not racing a multi-agent branch.
- #2512 (webhook fail-closed) merged to main (deb3355e) independently.
