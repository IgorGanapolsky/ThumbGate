# Gumroad Publisher Skill

## Purpose

Automate the full Gumroad product creation lifecycle: create product drafts,
generate PDF content, upload to Gumroad, and publish — all driven by a 7-day
content calendar. Integrates with the daily content generator and BrowserOS neo
for browser-based publishing.

**Slash command**: `/gumroad-publisher`

## When to Use

- When the daily content generator has staged 30 social drafts and one Gumroad
  product draft
- When a Gumroad product needs to be created from a draft .md file
- When the 7-day product calendar needs to advance (one product per day)

## Prerequisites

1. BrowserOS neo running with Chrome CDP on port 9111
2. Logged into Gumroad as `iganapolsky@gmail.com` in the browser session
3. Gumroad session cookies exported to /tmp/gumroad_cookies.txt
4. Product draft files in ~/Documents/AI-Agent-Sync/Email-Drafts/

## Workflow

### Step 1: Generate Product Content

Given a product draft .md file, generate:
- **PDF**: 10-page micro-ebook rendered via Playwright headless Chromium
- **Markdown**: Source file included as supplementary material
- **JSON schema**: Cost routing configuration schema for the cost-router skill

### Step 2: Create Product in Gumroad (Browser Automation)

Using BrowserOS neo Chrome CDP:
1. Navigate to `https://gumroad.com/products/new`
2. Click "Digital product"
3. Fill name from draft title
4. Fill price (minimum $0.99 — Gumroad floor)
5. Click "Next: Customize"
6. Click "Add detail" → fill description from draft
7. Click "Save and continue"
8. Navigate to Content tab → click "Add version"
9. Upload PDF + Markdown files
10. Click "Publish and continue"
11. Return product URL: `https://iganapolsky.gumroad.com/l/{product_id}`

### Step 3: Track Product

Record in local product database:
- Product URL
- Gumroad product ID
- Price, tags, description
- Publish date
- Status (draft/published)

### Step 4: Generate Social Media Drafts

For each of the 10 platforms, generate 3 content pieces:
- LinkedIn, X, Skool, BiggerPockets, Reddit, ZyVOP, HN, Bluesky, Threads, Dev.to
- Write .md drafts to ~/Documents/AI-Agent-Sync/Email-Drafts/

### Step 5: Update 7-Day Calendar

Mark the current day as published, advance to the next product in the calendar.

## Key Constraints

- Gumroad minimum price is $0.99 (cannot use $0.06)
- Browser automation uses Playwright + CDP, not curl (Inertia.js SPA form)
- Form filling must use `fill()` or `insertText()` — DOM manipulation alone fails React state
- All social media posts are **DRAFTS ONLY** — no auto-posting

## Files

- `scripts/gumroad-product-publisher.js` — Full automation script
- `scripts/daily-content-generator.js` — Daily 30-piece content generator
- `scripts/revenue-observability-dashboard.js` — Revenue dashboard
- `scripts/social-analytics/pollers/gumroad.js` — Gumroad analytics poller
- `.agents/skills/gumroad-publisher/SKILL.md` — This file

## Related Skills

- `daily-content-generator` — Generates 30 social media drafts daily
- `revenue-observability` — Real-time revenue and analytics dashboard
- `social-draft-generator` — Platform-specific content formatting
