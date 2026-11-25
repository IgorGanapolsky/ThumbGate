---
"thumbgate": patch
---

thumbgate.ai's sitemap now gives each page a `<lastmod>` taken from the page's own JSON-LD `dateModified` (or `datePublished`), so answer engines can see which pages are fresh. `/llms-full.txt` now serves the long-form `llm-context.md` instead of a 404.
