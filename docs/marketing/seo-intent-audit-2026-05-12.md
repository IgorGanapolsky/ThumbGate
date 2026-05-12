# SEO Intent-Alignment Audit — 36 Guide Pages

**Framework:** [Search Engine Land — Why intent alignment matters more than perfect technical SEO](https://searchengineland.com/intent-alignment-technical-seo-476823) (Dan Wiggins, May 2026). Once a site has technical-SEO parity, ranking shifts to whether page content matches what searchers actually want.

**Heuristic used:** For each `public/guides/*.html`, score `<title> + <h1> + <meta name="description">` text for:
- **Jargon score** — count of internal-vocabulary words searchers don't naturally type (`autoresearch`, `proxy-pointer`, `metaclaw`, `workflow-sentinel`, `progressive-disclosure`, `meta-agent`, `harness`, `spec-gate`, `pare`, `reward-hacking`, etc.)
- **Searcher score** — count of words searchers actually use (`how to`, `stop`, `prevent`, `block`, `fix`, `claude`, `cursor`, `agent`, `mistake`, `force-push`, `hallucinated`, `production`, `rollback`, `undo`)
- **Gap** = jargon − searcher (positive = page is jargon-heavy and searcher-hostile)

**Caveat:** Heuristic, not data-driven. Real audit needs Google Search Console queries + CTR + Plausible bounce data. Plausible API key isn't on this machine, so this is a code-static analysis.

---

## Top searcher-aligned pages (the model — keep doing this)

| Page | Searcher words | Notes |
|---|---|---|
| `/best-tools-stop-ai-agents-breaking-production` | 8 | Listicle format, direct intent match |
| `/cursor-agent-guardrails` | 5 | Has install command (but see duplication below) |
| `/cursor-prevent-repeated-mistakes` | 5 | Same H1 as above — duplicate |
| `/stop-repeated-ai-agent-mistakes` | 5 | Direct "how-to-stop" framing |
| `/ai-agent-governance-sprint` | 3 | High-ticket sprint page, on-target |

## Top intent-mismatched pages (rewrite candidates)

| Page | Jargon | Searcher | Recommended rewrite direction |
|---|---|---|---|
| `/proxy-pointer-rag-guardrails` | 1 | 0 | "How to stop Claude from showing wrong images in RAG answers" |
| `/ai-search-topical-presence` | 0 | 0 | "How to make ChatGPT/Perplexity recommend your tool" |
| `/semantic-programmatic-seo-guardrails` | 0 | 0 | Likely kill — niche SEO-industry jargon, not buyer-facing |
| `/native-messaging-host-security` | 0 | 0 | "How to stop your AI browser extension from leaking data" |
| `/relational-knowledge-ai-recommendations` | 0 | 0 | "How AI models pick which tools to recommend" |
| `/agent-harness-optimization` | 1 | 2 | "Stop Claude/Cursor from burning tokens on failed retries" |
| `/autoresearch-agent-safety` | 1 | 2 | "How to stop self-improving coding agents going off-rails" |

## Concrete cannibalization issue — shipped fix

**`/guides/cursor-agent-guardrails` and `/guides/cursor-prevent-repeated-mistakes`** have identical `<title>` ("Cursor Agent Guardrails | Stop Repeated Mistakes with ThumbGate") and identical `<h1>` ("Cursor Guardrails That Block Repeated Mistakes"). Google sees two pages competing for the same query → splits ranking signal.

Body content differs:
- `cursor-prevent-repeated-mistakes`: TL;DR + `npx thumbgate init --agent cursor` install command + richer FAQ (3 questions) + clear pricing rail
- `cursor-agent-guardrails`: older "Why this page exists" framing + "GSD execution brief" boilerplate + 2-question FAQ + no install command

**Shipped (this PR):** 301 redirect `/guides/cursor-agent-guardrails` → `/guides/cursor-prevent-repeated-mistakes`. Consolidates ranking signal to the better page.

## Out of scope for this PR (intentional)

- Rewriting the 7 jargon-heavy pages. That's content work, not a redirect. Defer until we have actual Search Console data showing which of those 7 pages get inbound traffic worth saving.
- Killing pages with 0 inbound traffic. Same — needs the data.
- Schema-type alignment review (article suggests checking if `Service` vs `HowTo` vs `FAQPage` is the right choice). The current 14-schema-type stack may be overclaiming. Defer to a dedicated audit.

## Expected impact

- Cannibalization fix: 1-4 week window for Google re-crawl. Possible modest rank gain on "cursor guardrails / cursor prevent repeated mistakes" queries.
- Not a "make money today" lever. Compounds slowly. Worth doing because it's a one-line server change with zero downside.
