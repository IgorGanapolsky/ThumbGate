---
name: thumbgate-daily-discoveries
description: Autonomous daily publishing engine and monitoring skill for ThumbGate news and technical discoveries. Generates high-density engineering posts with full UTM attribution, synchronizes to Obsidian, schedules dual cron/launchd runs at 9:00 AM EST, and tracks publication ledgers.
---

# 📰 ThumbGate Daily Technical Discoveries & News Engine

This skill automates the daily harvesting, synthesis, UTM attribution, and multi-channel publication of ThumbGate engineering discoveries and release news.

---

## 🎯 Architecture & Operating Principles

1. **Daily Cadence (9:00 AM EST):** Runs once per calendar day. Avoids spam while establishing consistent technical authority.
2. **Dual Scheduling Redundancy:**
   - Primary: macOS crontab (`0 9 * * * /bin/bash scripts/thumbgate-daily-discoveries-publish.sh ...`)
   - Fallback: macOS LaunchAgent (`~/Library/LaunchAgents/com.thumbgate.daily-publish.plist`)
   - Note: GitHub Actions `schedule:` is strictly limited to `codeql.yml` per repo hygiene tests.
3. **Full UTM Attribution & Tracked Redirects:**
   - All outbound links to `thumbgate.ai` must use `buildUTMLink` from `scripts/social-analytics/utm.js`.
   - Outbound pro/checkout links must route through `/go/pro` (`serveTrackedLinkRedirect` in `src/api/server.js`) to capture first-party funnel telemetry.
4. **Multi-Surface Staging & Sync:**
   - Staged locally at `docs/marketing/daily-discoveries/YYYY-MM-DD-<slug>.md`.
   - Synchronized to the CEO's Obsidian Vault at `~/Documents/Igor/Research/Daily-Discoveries/`.
   - Logged idempotently to `.thumbgate/daily-discoveries-ledger.jsonl`.
   - Dispatches to Dev.to / Zernio if API keys are configured.

---

## 🛠️ CLI Commands & Usage

```bash
# Preview today's technical discovery without making mutations or network calls
node scripts/thumbgate-daily-discoveries-publish.js --dry-run

# Output structured JSON report
node scripts/thumbgate-daily-discoveries-publish.js --json

# Force publish/restage today's discovery even if already logged in ledger
node scripts/thumbgate-daily-discoveries-publish.js --force

# Shell wrapper (used by crontab / launchd)
./scripts/thumbgate-daily-discoveries-publish.sh

# Run test suite
node --test tests/thumbgate-daily-discoveries-publish.test.js
```

---

## 📋 Pre-Flight Verification Checklist

- [ ] Verify `node --test tests/thumbgate-daily-discoveries-publish.test.js` passes.
- [ ] Verify outbound links contain valid UTM parameters (`utm_source=daily_discoveries`, `utm_campaign=daily_technical_discoveries`).
- [ ] Verify `launchctl list | grep thumbgate` reports exit code 0.
- [ ] Verify `crontab -l | grep thumbgate` contains the 9:00 AM daily trigger.
- [ ] Check `.thumbgate/daily-discoveries-ledger.jsonl` for recent execution receipts.
