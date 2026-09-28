---
name: article-syndication-pipeline
description: Technical article syndication pipeline for cross-posting Dev.to articles to CoderLegion and other developer platforms with canonical URL preservation, UTM parameter attribution, and contributor onboarding compliance.
---

# ✍️ Article Syndication & Contributor Pipeline

This skill guides the autonomous syndication of ThumbGate technical discoveries, security postmortems, and engineering deep dives across developer platforms (Dev.to, CoderLegion, Hashnode, Medium).

---

## 🎯 Architecture & Operating Directives

1. **Canonical SEO Integrity:**
   - Always preserve the primary origin as the canonical URL (e.g. `https://dev.to/igorganapolsky/...`).
   - Syndicated copies on CoderLegion or elsewhere must link back to avoid search engine duplicate-content penalties.
2. **First-Party Revenue Attribution:**
   - All inbound links to `thumbgate.ai` must include UTM campaign tags (`utm_source=coderlegion`, `utm_medium=community`, `utm_campaign=guest-post`).
   - Conversion links (Pro license checkout) must route through `/go/pro` (`https://thumbgate.ai/go/pro?utm_source=...`) to ensure server-side redirect logging.
3. **CoderLegion Contributor Compliance:**
   - URL import endpoint: `https://coderlegion.com/import-post`.
   - Supports 2 imported Dev.to articles with full attribution.
   - Contributor checklist: `https://coderlegion.com/guest-blog-checklists`.
   - All imported posts undergo editorial review before appearing on the main feed.

---

## 🛠️ Step-by-Step Workflow

1. **Verify Original Article:**
   Verify original URL exists, returns HTTP 200, and has correct canonical tags.
2. **Fetch via Platform Parser:**
   Submit `import_url` to `https://coderlegion.com/import-post`.
3. **Review & Confirm Metadata:**
   Confirm title, tags (`ai`, `security`, `architecture`, `opensource`), and backlink to canonical source.
4. **Publish & Track:**
   Submit publication step and record post URL in session log and Comet browser tab.
