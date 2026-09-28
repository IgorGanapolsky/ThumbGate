---
name: thumbgate-daily-discoveries
description: Autonomous daily publishing engine for ThumbGate technical discoveries. One post per calendar day, staged locally with UTM links and a publication ledger. The live schedule is thumbgate-always-on-promotion, not the 9:00 and 18:30 lines disabled on 2026-10-05.
---

# 📰 ThumbGate Daily Technical Discoveries & News Engine

This skill automates the daily harvesting, synthesis, UTM attribution, and multi-channel publication of ThumbGate engineering discoveries and release news.

---

## 🎯 Architecture & Operating Principles

1. **Daily Cadence:** One discovery per calendar day. The live trigger is `scripts/thumbgate-always-on.sh` (see `thumbgate-always-on-promotion`).
2. **Schedule that stays off:** The 9:00 and 18:30 crontab lines that call `thumbgate-daily-discoveries-publish.sh` directly stay commented. `com.thumbgate.daily-publish` stays unloaded. GitHub Actions `schedule:` stays limited to `codeql.yml`.
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

# Direct publisher. Cron calls scripts/thumbgate-always-on.sh, which runs this once per day.
node scripts/thumbgate-daily-discoveries-publish.js --json

# Run test suite
node --test tests/thumbgate-daily-discoveries-publish.test.js
```

---

## 📋 Pre-Flight Verification Checklist

- [ ] Verify `node --test tests/thumbgate-daily-discoveries-publish.test.js` passes.
- [ ] Verify outbound links contain valid UTM parameters (`utm_source=daily_discoveries`, `utm_campaign=daily_technical_discoveries`).
- [ ] Verify `crontab -l | grep thumbgate-always-on` shows `5 9 * * *` and `0 */4 * * *`.
- [ ] The 9:00 and 18:30 lines that call this publisher directly stay commented. They were disabled on 2026-10-05. `scripts/thumbgate-always-on.sh` is the live trigger and it does not send email.
- [ ] `com.thumbgate.daily-publish` stays unloaded. The plist on disk has a `.disabled-chief-cold-send-20261005` suffix.
- [ ] Check `.thumbgate/daily-discoveries-ledger.jsonl` for recent execution receipts.
