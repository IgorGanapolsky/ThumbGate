---
name: thumbgate-daily-discoveries
description: Daily technical-content staging, engagement polling, and reply-draft routine for ThumbGate.
---

# ThumbGate daily technical-content routine

Use this routine to turn a verified engineering finding into one useful technical post, then track responses without sending duplicate or unsupported claims.

## Daily routine

The LaunchAgent runs at 9:00 AM local time. It stages one canonical technical article, polls available engagement metrics, and queues reply drafts. It sends no posts or replies.

1. Review the staged article and confirm each technical claim against its cited commit or source.
2. Adapt the finding to the rules and format of each relevant community. Do not paste the same promotion everywhere.
3. Use the canonical ThumbGate URL and UTM links from the article. Disclose the ThumbGate affiliation.
4. Before each external post, add an OPEN row to `coordination/LOCKS.md` and comment on the Ops Coordination Linear issue. Mark the row DONE after verifying the post URL.
5. Review `.thumbgate/reply-drafts.jsonl` for useful questions. Reply in the platform only when the answer is accurate, relevant, and welcome. Mark the coordination row DONE after verifying delivery.
6. Review the metrics database and the daily log. Record which posts led to meaningful discussion or attributed visits.

Skip posts that repeat yesterday's point, lack evidence, violate a community's rules, or expose private or employer information. Do not invent customer results or product capabilities.

## What the automation supports

The daily article is staged at `docs/marketing/daily-discoveries/YYYY-MM-DD-<slug>.md`, its canonical HTML is written under `public/blog/`, and a receipt is added to `.thumbgate/daily-discoveries-ledger.jsonl`. A second run on the same date skips an existing staged article. The article uses UTM-tagged links. The Obsidian copy is written only when the vault is available and has no conflicting claim.

The scheduled command uses `--stage-only`, so a configured Dev.to key cannot trigger publication. The default metrics poller reads GitHub and Plausible metrics and uses Zernio for connected social accounts when its API key exists. Legacy direct pollers for Reddit, LinkedIn, Threads, Instagram, TikTok, and YouTube are disabled by default. Reddit and Bluesky monitors queue reply drafts. The LinkedIn reply monitor currently reports that its required Community Management API access is unavailable.

No working integration was confirmed for Hacker News, Hashnode, Medium, or ZyVOP. The HubSpot social connector denied access, and Zernio publishing is disabled by project policy. Do not describe those channels as scheduled or monitored until an authorized path is verified.

## Run it by hand

```bash
node scripts/thumbgate-daily-discoveries-publish.js --dry-run --json
node scripts/thumbgate-daily-discoveries-publish.js --stage-only --json
./scripts/thumbgate-daily-discoveries-publish.sh
bash scripts/install-thumbgate-daily-publish-launchd.sh
bash scripts/install-thumbgate-daily-publish-launchd.sh --uninstall
```

The LaunchAgent label is `com.thumbgate.daily-publish`. It is the only scheduler for this routine. Do not also add a cron entry.
