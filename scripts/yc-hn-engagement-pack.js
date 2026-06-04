#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_OUTPUT_DIR = path.join(__dirname, '..', 'docs', 'marketing');
const DEFAULT_SCHEDULE = 'daily 8:30';
const DEFAULT_SCHEDULE_ID = 'thumbgate-yc-hn-engagement-drafts';

function buildYcHnEngagementPack(options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  return {
    name: 'thumbgate-yc-hn-engagement-pack',
    generatedAt,
    status: 'draft_review_required',
    thesis: 'Win YC/Hacker News attention by contributing useful technical evidence where agent security, mobile security, open source infrastructure, and developer tooling already intersect.',
    noAutoPostRule: 'Never auto-post to Hacker News, LinkedIn, Reddit, X, or Threads. Generate drafts and require human approval for the exact text.',
    dailyCadence: [
      {
        slot: 'morning',
        action: 'scan',
        checks: [
          'HN front page + newest for AI agent security, MCP, mobile app security, devtools, CI, package supply chain, and token cost threads',
          'YC LinkedIn/company feed for launches adjacent to agent security, app security, infra, or developer workflow',
          'GitHub issues in LanceDB, MCP, Playwright, Stripe, and Node repos for real fixes ThumbGate can contribute',
        ],
        output: 'ranked opportunities with why-we-belong and draft-only response',
      },
      {
        slot: 'midday',
        action: 'contribute',
        checks: [
          'prefer one real GitHub issue reproduction or docs fix over five comments',
          'attach tests, screenshots, or reproduction evidence before mentioning ThumbGate',
          'avoid launch hijacking; congratulate first, add a technical angle second',
        ],
        output: 'one upstream PR candidate or one approved comment draft',
      },
      {
        slot: 'evening',
        action: 'measure',
        checks: [
          'record approved sends, replies, profile clicks, GitHub stars, npm installs, and thumbgate.ai referrals',
          'capture lessons into ThumbGate/RAG only after evidence exists',
          'drop channels that produce impressions without buyer-intent replies',
        ],
        output: 'daily scorecard and next-day targets',
      },
    ],
    opportunityFilters: [
      'Does the thread involve agents taking actions, security boundaries, app/API abuse, supply chain risk, observability, or cost control?',
      'Can we add concrete technical insight without pitching?',
      'Can we mention ThumbGate only as build context, not as the point of the comment?',
      'Would the comment still be valuable if the product name were removed?',
    ],
    currentLinkedInDraft: {
      source: 'Y Combinator LinkedIn post about RASPIRE building app security at AI speed',
      comment: [
        'Congrats to the RASPIRE team. The interesting shift here is that AI changes the economics of both sides: attackers can scale app/API abuse faster, but defenders can also move enforcement closer to the action boundary.',
        '',
        'For mobile and agentic systems, the winning pattern looks less like another dashboard and more like pre-action controls plus evidence: what was the app or agent about to do, what policy fired, and what proof exists after the block. That is the part buyers will start asking for as AI-speed attacks become normal.',
      ].join('\n'),
      whyItWorks: [
        'congratulates the launch instead of hijacking it',
        'connects RASPIRE mobile security to ThumbGate action-boundary security',
        'does not paste a product link or claim partnership',
      ],
    },
    showHnDraft: {
      title: 'Show HN: ThumbGate – Stop AI coding agents from repeating the same mistakes',
      url: 'https://github.com/IgorGanapolsky/ThumbGate',
      text: [
        "I've been using AI coding agents daily across Claude Code, Cursor, Codex, Gemini CLI, and Amp. The pattern that kept costing me wasn't that agents make mistakes. It was paying for the same mistake twice.",
        '',
        'ThumbGate is an open-source Node.js CLI that sits at the tool-call boundary. You thumbs-down a bad agent action once, ThumbGate turns that correction into an inspectable prevention rule, and the next matching command/edit/API call is blocked or warned before it runs.',
        '',
        'The gate path is deterministic: local rules, command/tool metadata, audit logs, and local retrieval via LanceDB. The point is not to make the model smarter. The point is to make repeated failures harmless and auditable across agent surfaces.',
        '',
        'Install:',
        '',
        'npx thumbgate init',
        '',
        "I'd love feedback from HN on three things:",
        '',
        '1. Is feedback-to-prevention-rule the right abstraction for agent safety?',
        '2. Should the default posture be warn+audit, with strict mode for hard blocks?',
        '3. For teams, is cross-agent rule propagation valuable enough to pay for, or should the paid wedge be observability/cost controls first?',
      ].join('\n'),
    },
    hnCommentDrafts: [
      {
        threadType: 'AI agents / coding agents',
        comment: 'The operational problem I keep seeing is not one bad agent action. It is repeatability: the same unsafe command, skipped test, or broken migration pattern gets retried in a new session with fresh confidence. I think the enforcement layer belongs at the tool-call boundary, where you can turn a prior correction into an inspectable rule before the next action executes.',
      },
      {
        threadType: 'Mobile/app security at AI speed',
        comment: 'AI makes app/API abuse cheaper to scale, but it also makes the defender workflow more evidence-driven. The useful control is not just detection after the fact; it is a pre-action decision trail: what was about to happen, what rule or policy stopped it, and what proof can a reviewer inspect later.',
      },
      {
        threadType: 'LLM token/cost control',
        comment: 'Token budgets become much more useful when tied to actions, not just prompts. If an agent is about to rerun a failed plan, call an expensive API, or loop on the same tool trace, the budget gate should be able to warn/block before spend happens. Observability after the bill lands is too late.',
      },
    ],
    metrics: [
      'approved drafts generated',
      'approved comments posted manually',
      'replies from maintainers/founders/security buyers',
      'GitHub profile/repo clicks from HN/LinkedIn referrers',
      'npm installs within 24h of approved engagement',
      'thumbgate.ai pricing and dashboard-demo visits from those referrers',
    ],
  };
}

function formatYcHnEngagementPack(pack) {
  const lines = [
    '# YC / Hacker News Engagement Pack',
    '',
    `Generated: ${pack.generatedAt}`,
    `Status: ${pack.status}`,
    '',
    '## Thesis',
    '',
    pack.thesis,
    '',
    '## Hard Rule',
    '',
    pack.noAutoPostRule,
    '',
    '## Daily Cadence',
    '',
  ];
  for (const item of pack.dailyCadence) {
    lines.push(`### ${item.slot}: ${item.action}`, '');
    for (const check of item.checks) lines.push(`- ${check}`);
    lines.push('', `Output: ${item.output}`, '');
  }
  lines.push('## LinkedIn Draft For Current YC Post', '', pack.currentLinkedInDraft.comment, '', 'Why it works:');
  for (const reason of pack.currentLinkedInDraft.whyItWorks) lines.push(`- ${reason}`);
  lines.push('', '## Show HN Draft', '', `Title: ${pack.showHnDraft.title}`, `URL: ${pack.showHnDraft.url}`, '', pack.showHnDraft.text, '', '## HN Comment Drafts', '');
  for (const draft of pack.hnCommentDrafts) {
    lines.push(`### ${draft.threadType}`, '', draft.comment, '');
  }
  lines.push('## Metrics', '');
  for (const metric of pack.metrics) lines.push(`- ${metric}`);
  return `${lines.join('\n')}\n`;
}

function writeYcHnEngagementPack(outputDir = DEFAULT_OUTPUT_DIR, options = {}) {
  const pack = buildYcHnEngagementPack(options);
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, 'yc-hn-engagement-pack.json');
  const markdownPath = path.join(outputDir, 'yc-hn-engagement-pack.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(pack, null, 2)}\n`);
  fs.writeFileSync(markdownPath, formatYcHnEngagementPack(pack));
  return { pack, jsonPath, markdownPath };
}

function buildYcHnEngagementSchedule(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..'));
  const outputDir = path.resolve(options.outputDir || path.join(repoRoot, 'docs', 'marketing'));
  const scriptPath = path.join(repoRoot, 'scripts', 'yc-hn-engagement-pack.js');
  const command = [
    `const pack = require(${JSON.stringify(scriptPath)});`,
    `const result = pack.writeYcHnEngagementPack(${JSON.stringify(outputDir)});`,
    'process.stdout.write(JSON.stringify({ status: "drafts_generated", jsonPath: result.jsonPath, markdownPath: result.markdownPath, autoPost: false }, null, 2) + "\\n");',
  ].join(' ');
  return {
    id: options.id || DEFAULT_SCHEDULE_ID,
    name: 'ThumbGate YC/HN engagement draft generator',
    description: 'Daily draft-only YC/HN/LinkedIn engagement pack. Never posts automatically.',
    schedule: options.schedule || DEFAULT_SCHEDULE,
    command,
    workingDirectory: repoRoot,
    autoPost: false,
  };
}

function installYcHnEngagementSchedule(options = {}, api = {}) {
  const { createSchedule } = api.createSchedule
    ? api
    : require('./schedule-manager');
  const schedule = buildYcHnEngagementSchedule(options);
  return createSchedule(schedule);
}

module.exports = {
  DEFAULT_SCHEDULE,
  DEFAULT_SCHEDULE_ID,
  buildYcHnEngagementPack,
  buildYcHnEngagementSchedule,
  formatYcHnEngagementPack,
  installYcHnEngagementSchedule,
  writeYcHnEngagementPack,
};

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  if (args.has('--install-schedule')) {
    console.log(JSON.stringify(installYcHnEngagementSchedule(), null, 2));
  } else if (args.has('--schedule-preview')) {
    console.log(JSON.stringify(buildYcHnEngagementSchedule(), null, 2));
  } else {
    const { jsonPath, markdownPath } = writeYcHnEngagementPack();
    console.log(JSON.stringify({ jsonPath, markdownPath }, null, 2));
  }
}
