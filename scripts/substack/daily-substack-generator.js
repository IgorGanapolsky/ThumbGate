#!/usr/bin/env node
'use strict';

/**
 * Daily Substack & Monetization Auto-Publisher
 * Generates daily dated Substack newsletters + Substack Notes with the 6-tier
 * monetization ladder ($0 MIT CLI -> 7-day No-Card Pro Trial -> $19/mo Pro ->
 * $49 Rule-Pack -> $499 Diagnostic -> $25,000 Custom 15-Bot "Bops" SMB System /
 * $3,000/mo Retainer -> $100 South Florida Tax-Deed Pre-Bid Packet).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateDailySubstackMonetizationPack } = require('../fast-money-engine');

const POSTS_DIR = path.join(__dirname, '../../docs/substack-output');
const VAULT_SUBSTACK_DIR = path.join(
  os.homedir(),
  'Documents',
  'AI-Agent-Sync',
  'Projects',
  'ThumbGate',
  'Substack-Daily',
);

const EVERGREEN_TOPICS = [
  {
    title: "Why 'Responsive = Responsible' is Destroying Your Startup's Growth",
    slug: 'responsive-equals-responsible-myth',
    funnel: 'https://thumbgate.ai/go/diagnostic-direct?utm_source=substack&utm_medium=evergreen',
    price: '$499 Enterprise Workflow Gate Diagnostic',
  },
  {
    title: 'Super-Agents & Airlocks: How to Let AI Run Your Backend Without Breaking Production',
    slug: 'super-agents-and-airlocks-production-safety',
    funnel: 'https://thumbgate.ai/go/bundle-49?utm_source=substack&utm_medium=evergreen',
    price: '$49 Production Rule-Pack Kit',
  },
  {
    title: 'Building a $25,000 15-Bot Autonomous Revenue Engine with Bops, Drex Max v1, and ThumbGate',
    slug: 'autonomous-revenue-engine-claude-thumbgate',
    funnel: 'https://thumbgate.ai/go/pro-direct?trial=1&trial_no_card=1&utm_source=substack&utm_medium=evergreen',
    price: 'ThumbGate Pro (7-Day Free Trial, then $19/mo)',
  },
];

function runDailySubstackPublisher({ writeVault = true } = {}) {
  fs.mkdirSync(POSTS_DIR, { recursive: true });

  for (const topic of EVERGREEN_TOPICS) {
    const content = `# ${topic.title}\n\n*Published by Igor Ganapolsky / ThumbGate AI Intelligence*\n\nTo build a high-margin, scalable business without burning out or breaking production:\n1. **15 Role-Isolated Agents ("Bops" Architecture):** Dedicated compute, email, and Git worktree per bot.\n2. **Zero-Token Single-Forward-Pass Decisions (Drex Max v1 + ThumbGate PreToolUse):** Evaluate safety and tool routing in <0.05ms with 0 generated output tokens.\n\n- **Get ${topic.price}:** [Unlock here](${topic.funnel})\n`;
    fs.writeFileSync(path.join(POSTS_DIR, `${topic.slug}.md`), content, 'utf8');
  }

  const dailyPack = generateDailySubstackMonetizationPack({
    writeFiles: true,
    outputDir: POSTS_DIR,
  });

  if (writeVault) {
    try {
      fs.mkdirSync(VAULT_SUBSTACK_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(VAULT_SUBSTACK_DIR, `${dailyPack.dateIso}-substack-post.md`),
        dailyPack.markdown,
        'utf8',
      );
      fs.writeFileSync(
        path.join(VAULT_SUBSTACK_DIR, `${dailyPack.dateIso}-substack-note.txt`),
        `${dailyPack.substackNote}\n`,
        'utf8',
      );
      fs.writeFileSync(
        path.join(VAULT_SUBSTACK_DIR, 'latest-daily-substack.json'),
        `${JSON.stringify(dailyPack, null, 2)}\n`,
        'utf8',
      );
    } catch {
      /* best-effort vault mirror */
    }
  }

  return dailyPack;
}

if (require.main === module) {
  const result = runDailySubstackPublisher();
  process.stdout.write(`${JSON.stringify({ ok: result.ok, dateIso: result.dateIso, title: result.title, postPath: result.postPath, links: result.links }, null, 2)}\n`);
}

module.exports = {
  EVERGREEN_TOPICS,
  runDailySubstackPublisher,
};
