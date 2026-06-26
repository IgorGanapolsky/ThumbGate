#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { ensureDir, writeJson } = require('./fs-utils');
const { buildRevenueLinks } = require('./gtm-revenue-loop');
const { getLiveStatus } = require('./stripe-live-status');
const { loadSalesLeads, summarizeSalesPipeline } = require('./sales-pipeline');
const {
  getZaiApiKey,
  getZaiBaseUrl,
  getZaiModel,
} = require('./llm-client');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_REPORT_SLUG = 'okara-cmo-automation';
const APPROVAL_PHRASE = 'APPROVE OKARA MONEY PROMO ACTION';
const OKARA_GA_GSC_APPROVAL_PHRASE = 'APPROVE OKARA GA GSC CONNECT';
const REQUIRED_CHANNELS = [
  'Reddit',
  'LinkedIn',
  'Threads',
  'Bluesky',
  'Instagram',
  'YouTube Community',
  'X/Twitter',
  'Medium',
];
const PUBLIC_APP_ORIGIN = 'https://thumbgate.ai';
const SOURCE_PDFS = [
  '/Users/igorganapolsky/Downloads/Gmail - Introducing me, the CMO, and my team.pdf',
  '/Users/igorganapolsky/Downloads/Gmail - Introducing SEO and GEO Agent.pdf',
];
const WEB_SOURCE_INPUTS = [
  {
    url: 'https://okara.ai/',
    title: 'Okara AI CMO',
    use: 'Model the marketing operating system as approval-gated agents for Reddit, SEO, GEO, X, LinkedIn, HN, content, and technical SEO.',
  },
  {
    url: 'https://cameronrwolfe.substack.com/p/agentic-rl',
    title: 'Agentic RL: Frameworks and Best Practices',
    use: 'Product improvement input: score long-horizon agent trajectories, tool calls, environment state, step-level rewards, and sandboxed rollout evidence.',
  },
  {
    url: 'https://x.com/JulianGoldieSEO/status/2068836620133105695',
    title: 'Goldie Ranking Swarm: 7-agent SEO pipeline',
    use: 'SEO/GEO campaign input: structure ThumbGate content around agent swarms, ranking pipeline, and AI-search distribution; verify exact tweet text before quoting.',
  },
];

function buildPublicRevenueLinks() {
  return buildRevenueLinks({ appOrigin: PUBLIC_APP_ORIGIN });
}

function normalizeDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function parseArgs(argv = []) {
  const options = {
    write: false,
    json: false,
    date: '',
    reportDir: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--write') {
      options.write = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--date' && argv[index + 1]) {
      options.date = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith('--date=')) {
      options.date = arg.slice('--date='.length).trim();
      continue;
    }
    if (arg === '--report-dir' && argv[index + 1]) {
      options.reportDir = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith('--report-dir=')) {
      options.reportDir = arg.slice('--report-dir='.length).trim();
    }
  }

  return options;
}

async function fetchJson(url, fetchFn = globalThis.fetch) {
  if (typeof fetchFn !== 'function') {
    return { ok: false, status: 'fetch_unavailable', url };
  }
  try {
    const response = await fetchFn(url, { method: 'GET' });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      url,
      json,
    };
  } catch (error) {
    return {
      ok: false,
      status: 'request_failed',
      url,
      error: error.message,
    };
  }
}

async function fetchHead(url, fetchFn = globalThis.fetch) {
  if (typeof fetchFn !== 'function') {
    return { ok: false, status: 'fetch_unavailable', url };
  }
  try {
    const response = await fetchFn(url, { method: 'HEAD' });
    return {
      ok: response.ok,
      status: response.status,
      url,
    };
  } catch (error) {
    return {
      ok: false,
      status: 'request_failed',
      url,
      error: error.message,
    };
  }
}

async function collectLiveEvidence({
  repoRoot = REPO_ROOT,
  fetchFn = globalThis.fetch,
  stripeStatusFn = getLiveStatus,
} = {}) {
  const links = buildPublicRevenueLinks();
  const leads = loadSalesLeads({ repoRoot });
  const pipelineSummary = summarizeSalesPipeline(leads);
  const [stripe, health, checkout] = await Promise.all([
    stripeStatusFn(),
    fetchJson(`${links.appOrigin}/health`, fetchFn),
    fetchHead(links.proCheckoutLink, fetchFn),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    links,
    pipeline: pipelineSummary,
    stripe,
    productionHealth: health,
    checkoutRoute: checkout,
  };
}

function buildScore(stageCounts = {}) {
  const replied = Number(stageCounts.replied || 0);
  const checkoutStarted = Number(stageCounts.checkout_started || 0);
  const sprintIntake = Number(stageCounts.sprint_intake || 0);
  const paid = Number(stageCounts.paid || 0);
  const contacted = Number(stageCounts.contacted || 0);
  const score = (replied * 10) + (checkoutStarted * 15) + (sprintIntake * 18) + (paid * 35) + Math.min(contacted, 10);
  return Math.max(0, Math.min(100, score));
}

function buildZaiAccelerationStatus(env = process.env) {
  const configured = Boolean(getZaiApiKey(env));
  return {
    provider: 'zai',
    preferred: true,
    configured,
    model: getZaiModel(env),
    baseUrl: getZaiBaseUrl(env),
    secretStatus: configured ? 'local_env_only_not_exported' : 'missing_key',
    moneyUseCases: [
      'score warm replies and buyer-fit signals',
      'draft platform-specific promo copy for human-approved posting',
      'summarize Okara SEO/GEO inputs into daily article briefs',
      'rank one next-dollar action from live evidence',
    ],
    boundary: 'Z.ai may draft, score, and summarize; ThumbGate deterministic gates still own allow/block decisions.',
  };
}

function buildAutomationPack({
  generatedAt = new Date().toISOString(),
  date = normalizeDate(new Date(generatedAt)),
  evidence = {},
  sourcePdfs = SOURCE_PDFS,
  webSources = WEB_SOURCE_INPUTS,
  zaiAcceleration = buildZaiAccelerationStatus(),
} = {}) {
  const stageCounts = evidence.pipeline?.byStage || {};
  const links = evidence.links || buildPublicRevenueLinks();
  const score = buildScore(stageCounts);

  return {
    generatedAt,
    date,
    state: 'approval_gated_money_promo_automation_ready',
    approvalPhrase: APPROVAL_PHRASE,
    okaraGaGscApprovalPhrase: OKARA_GA_GSC_APPROVAL_PHRASE,
    sourcePdfs,
    webSources,
    zaiAcceleration,
    okaraBrief: {
      cmo: 'Okara CMO says it will operate social, organic, competitive landscape, brand voice, marketing strategy, and technical-audit work from the dashboard.',
      seo: 'SEO Agent needs Google Analytics and Google Search Console to rank ThumbGate on Google, Bing, Brave, and related search surfaces.',
      geo: 'GEO Agent needs the same data to increase ThumbGate citations in ChatGPT, Claude, Perplexity, and Grok.',
      setupGap: 'GA and GSC connection is the first human-confirmed external setup step before Okara can optimize from real traffic instead of a snapshot.',
    },
    safety: {
      externalActions: 'Do not post, DM, InMail, email, submit forms, launch ads, change billing, or edit public profiles without action-time confirmation.',
      directPublishing: 'Use direct platform APIs or logged-in browser/Computer Use paths only.',
      llmBoundary: 'Z.ai can accelerate ranking, drafting, and summarization; it does not replace deterministic pre-action gates.',
      evidence: 'Every daily run must refresh production health, checkout route, pipeline byStage, and Stripe/live-payment status before making money claims.',
    },
    commercialTruth: {
      free: 'Free local CLI: 2 captures/day, 10 total, 3 active rules.',
      pro: 'Pro: $19/mo or $149/yr via hosted checkout.',
      enterprise: 'Workflow Hardening Sprint and Enterprise are intake-led, scoped after one real repeated workflow failure.',
      revenueClaim: 'Do not claim new revenue unless Stripe/payment evidence proves it in the current run.',
    },
    evidenceSnapshot: {
      pipelineByStage: stageCounts,
      score,
      stripeStatus: evidence.stripe?.status || 'unknown',
      stripeConfigured: Boolean(evidence.stripe?.configured),
      todayRevenue: evidence.stripe?.revenue?.today ?? null,
      productionHealth: evidence.productionHealth,
      checkoutRoute: evidence.checkoutRoute,
    },
    dailyLoop: [
      {
        step: 1,
        name: 'Truth refresh',
        command: 'npm run gtm:okara-automation:write',
        outcome: 'Refresh local evidence and approval queues before any money or promo claim.',
      },
      {
        step: 2,
        name: 'Reply and warm-lead triage',
        command: 'npm run sales:pipeline -- summary && npm run social:reply-monitor:dry',
        outcome: 'Identify only fresh actionable replies and route warm buyers before cold posting.',
      },
      {
        step: 3,
        name: 'SEO/GEO data unlock',
        command: 'Open Okara dashboard and connect GA + GSC after explicit approval.',
        outcome: 'Let SEO/GEO agents work from real traffic and search data.',
      },
      {
        step: 4,
        name: 'Draft promotion pack',
        command: 'npm run zai:smoke -- --json && npm run medium:weekly:draft && npm run social:post-everywhere:dry',
        outcome: 'Create cross-platform copy with Medium included; no posting until approved.',
      },
      {
        step: 5,
        name: 'Close the closest money path',
        command: 'Use OUTREACH_APPROVAL_QUEUE.md and post/send exactly one approved action.',
        outcome: 'Keep the next money action narrow, verifiable, and not spammy.',
      },
    ],
    productImprovementBacklog: [
      {
        priority: 1,
        source: 'Agentic RL',
        improvement: 'Add trajectory-level scoring for agent runs: state, tool action, observation, reward, and termination reason.',
        thumbgateWhy: 'ThumbGate already gates actions; trajectory scoring makes repeated-failure prevention measurable across long-horizon sessions.',
      },
      {
        priority: 2,
        source: 'Agentic RL',
        improvement: 'Treat each risky tool call as an environment interaction step with an intermediate reward: allow, block, require evidence, or route for approval.',
        thumbgateWhy: 'This makes the product story stronger than generic memory: ThumbGate has inspectable step-level feedback before execution.',
      },
      {
        priority: 3,
        source: 'Agentic RL',
        improvement: 'Keep sandbox and isolated-run evidence as first-class proof for high-risk actions.',
        thumbgateWhy: 'Agentic RL systems need isolated environments; buyers need the same concept for production-like coding agents.',
      },
    ],
    seoGeoBacklog: [
      {
        priority: 1,
        source: 'Okara SEO/GEO Agent',
        improvement: 'Connect GA4 and GSC, then map ThumbGate pages to search intent and AI-answer intent.',
        output: 'Keyword gap list, GEO citation targets, and article queue.',
      },
      {
        priority: 2,
        source: 'Goldie Ranking Swarm',
        improvement: 'Create a seven-agent SEO pipeline for ThumbGate: research, topical map, page brief, draft, technical SEO, backlink/community, measurement.',
        output: 'One article or landing-page update per day, Medium included for distribution.',
      },
      {
        priority: 3,
        source: 'Okara public positioning',
        improvement: 'Keep every SEO/GEO draft approval-gated and tied to real evidence, not automatic publishing.',
        output: 'Approval queue with exact destination, copy, and source URL.',
      },
    ],
    channelPlan: REQUIRED_CHANNELS.map((channel) => ({
      channel,
      status: 'queued_not_posted',
      rule: channel === 'Medium'
        ? 'Required. Do not claim post-everywhere completion without a Medium URL or blocker.'
        : 'Draft locally and verify direct platform path before posting.',
    })),
    approvalQueue: [
      {
        priority: 1,
        action: 'Connect Google Analytics and Google Search Console in Okara dashboard',
        reason: 'The SEO/GEO agents explicitly said they need GA and GSC before working from real traffic.',
        approvalPhrase: OKARA_GA_GSC_APPROVAL_PHRASE,
        destination: 'Okara dashboard / Google account UI',
        externalSideEffect: true,
      },
      {
        priority: 2,
        action: 'Publish one evidence-backed ThumbGate post pack across direct channels',
        reason: 'Okara CMO promised publishing, social, and community presence; ThumbGate already has direct-platform post tooling.',
        approvalPhrase: APPROVAL_PHRASE,
        destination: REQUIRED_CHANNELS.join(', '),
        externalSideEffect: true,
      },
      {
        priority: 3,
        action: 'Send one warm Workflow Hardening Sprint close to a buyer who names a repeated failure',
        reason: 'Pipeline has replies/intake but no paid stage; warm direct closes outrank cold content.',
        approvalPhrase: APPROVAL_PHRASE,
        destination: 'LinkedIn/Reddit/email, only after recipient and exact text are confirmed',
        externalSideEffect: true,
      },
    ],
    promotionDrafts: [
      {
        channel: 'LinkedIn',
        audience: 'AI engineering leaders and founders',
        text: [
          'AI-agent reliability is no longer a dashboard problem. It is an execution-boundary problem.',
          'ThumbGate turns a rejected agent action into a pre-action check, so the next risky tool call gets blocked before it touches code, money, or customer systems.',
          `Free local CLI to prove one repeat. Pro is ${links.proPriceLabel} when you need recall, sync, exports, and proof.`,
          links.proCheckoutLink,
        ].join('\n\n'),
      },
      {
        channel: 'Medium',
        audience: 'Search and AI-answer surfaces',
        title: 'Memory Is Not Enforcement: Why AI Agents Need Pre-Action Checks',
        text: 'Use the Medium draft lane to turn this into a full article before public posting. Include the difference between black-box memory and inspectable prevention rules.',
      },
      {
        channel: 'Reddit/Threads/Bluesky/X',
        audience: 'Builders using Claude Code, Codex, Cursor, Gemini CLI, Amp, OpenCode, and MCP tools',
        text: 'If your AI coding agent repeats the same mistake, do not just add another prompt rule. Capture the failure once, turn it into a local pre-action check, and block the next repeat before it runs. ThumbGate is free to try: npx thumbgate init',
      },
    ],
    nextMoneyAction: {
      action: 'Connect GA/GSC for Okara, then run the daily money-promo pack and approve exactly one warm close or post pack.',
      why: 'SEO/GEO agents are blocked without data; current pipeline has warm stages but 0 paid, so the next dollar needs data plus one approval-ready conversion action.',
      approvalPhrase: OKARA_GA_GSC_APPROVAL_PHRASE,
    },
  };
}

function fencedJson(value) {
  return ['```json', JSON.stringify(value, null, 2), '```'].join('\n');
}

function renderEvidenceLedger(pack) {
  return [
    '# Okara CMO Money + Promotion Evidence Ledger',
    '',
    `Generated: ${pack.generatedAt}`,
    '',
    '## Source PDFs',
    ...pack.sourcePdfs.map((source) => `- ${source}`),
    '',
    '## Web Inputs',
    ...pack.webSources.map((source) => `- ${source.title}: ${source.url}\n  Use: ${source.use}`),
    '',
    '## Okara Brief Extract',
    `- CMO: ${pack.okaraBrief.cmo}`,
    `- SEO: ${pack.okaraBrief.seo}`,
    `- GEO: ${pack.okaraBrief.geo}`,
    `- Setup gap: ${pack.okaraBrief.setupGap}`,
    '',
    '## Live Evidence Snapshot',
    fencedJson(pack.evidenceSnapshot),
    '',
    '## Z.ai Acceleration',
    fencedJson(pack.zaiAcceleration),
    '',
    '## Guardrails',
    `- External actions: ${pack.safety.externalActions}`,
    `- Direct publishing: ${pack.safety.directPublishing}`,
    `- LLM boundary: ${pack.safety.llmBoundary}`,
    `- Evidence: ${pack.safety.evidence}`,
    '',
  ].join('\n');
}

function renderExecutionBoard(pack) {
  return [
    '# Okara CMO Execution Board',
    '',
    `Status: ${pack.state}`,
    `Generated: ${pack.generatedAt}`,
    '',
    '## Daily Loop',
    ...pack.dailyLoop.flatMap((step) => [
      `### ${step.step}. ${step.name}`,
      `- Command: \`${step.command}\``,
      `- Outcome: ${step.outcome}`,
      '',
    ]),
    '## Score',
    `- Current explainable promo-readiness score: ${pack.evidenceSnapshot.score}/100`,
    `- Routing truth: ${JSON.stringify(pack.evidenceSnapshot.pipelineByStage)}`,
    `- Stripe status this run: ${pack.evidenceSnapshot.stripeStatus}`,
    `- Z.ai configured: ${pack.zaiAcceleration.configured ? 'yes' : 'no'} (${pack.zaiAcceleration.model})`,
    '',
    '## Completion Rule',
    '- A run is not complete until it has refreshed evidence, written the approval queue, and named exactly one next money action.',
    '',
    '## Product Improvement Backlog',
    ...pack.productImprovementBacklog.flatMap((item) => [
      `### P${item.priority}: ${item.improvement}`,
      `- Source: ${item.source}`,
      `- ThumbGate why: ${item.thumbgateWhy}`,
      '',
    ]),
  ].join('\n');
}

function renderBrandOperatingSystem(pack) {
  return [
    '# ThumbGate Brand Operating System for Okara CMO',
    '',
    '## Positioning',
    'ThumbGate is an operator-grade workflow hardening system for AI-assisted teams: it proves UI flows, checkout paths, browser automation, and agent actions before they cost money, reputation, or customer trust.',
    '',
    '## Buyer Motions',
    `- Free: ${pack.commercialTruth.free}`,
    `- Pro: ${pack.commercialTruth.pro}`,
    `- Enterprise/Sprint: ${pack.commercialTruth.enterprise}`,
    '',
    '## Claims Discipline',
    `- ${pack.commercialTruth.revenueClaim}`,
    '- Cite docs/COMMERCIAL_TRUTH.md and docs/VERIFICATION_EVIDENCE.md for product, price, and proof claims.',
    '- Prefer early-stage, pilot, and workflow-proof language over unsupported scale claims.',
    '',
    '## Voice',
    '- Clear, technical, evidence-backed.',
    '- Lead with one concrete repeated failure, not generic AI safety.',
    '- Never hide the approval boundary: ThumbGate blocks before execution.',
    '',
  ].join('\n');
}

function renderStakeholderTargetMap(pack) {
  return [
    '# Stakeholder Target Map',
    '',
    '## Highest Fit',
    '- Founders and CTOs shipping AI-agent or browser-automation workflows.',
    '- Engineering managers adopting Claude Code, Cursor, Codex, Gemini CLI, Amp, OpenCode, or MCP tooling.',
    '- Regulated or customer-facing teams that need approval boundaries, rollback proof, and audit evidence.',
    '',
    '## Route By Signal',
    '- Concrete repeated failure named: Workflow Hardening Sprint / Enterprise intake.',
    '- Solo builder with install intent: Pro checkout after one blocked repeat.',
    '- Curious but not urgent: Free CLI plus proof-backed guide.',
    '',
    '## Current Pipeline Truth',
    fencedJson(pack.evidenceSnapshot.pipelineByStage),
    '',
  ].join('\n');
}

function renderOutreachApprovalQueue(pack) {
  return [
    '# Outreach Approval Queue',
    '',
    'No public post, DM, InMail, email, profile edit, ad, form submission, or billing change is authorized by this file alone.',
    '',
    '## Required Approval Phrases',
    `- General promo/money action: \`${pack.approvalPhrase}\``,
    `- Okara GA/GSC connection: \`${pack.okaraGaGscApprovalPhrase}\``,
    '',
    '## Queue',
    ...pack.approvalQueue.flatMap((entry) => [
      `### P${entry.priority}: ${entry.action}`,
      `- Reason: ${entry.reason}`,
      `- Destination: ${entry.destination}`,
      `- External side effect: ${entry.externalSideEffect ? 'yes' : 'no'}`,
      `- Approval phrase: \`${entry.approvalPhrase}\``,
      '',
    ]),
  ].join('\n');
}

function renderLinkedInPromotionQueue(pack) {
  const linkedInDraft = pack.promotionDrafts.find((draft) => draft.channel === 'LinkedIn');
  return [
    `# LinkedIn Promotion Queue ${pack.date}`,
    '',
    '## Draft 1',
    `- Audience: ${linkedInDraft.audience}`,
    '- Status: queued_not_posted',
    `- Approval phrase: \`${pack.approvalPhrase}\``,
    '',
    linkedInDraft.text,
    '',
  ].join('\n');
}

function renderLinkedInPremiumCommandBoard(pack) {
  return [
    '# LinkedIn Premium Feature Command Board',
    '',
    '## Use These Features',
    '- Profile viewers: rank founders, CTOs, AI/product leaders, and workflow owners first.',
    '- Search: query for MCP, Claude Code, Cursor, AI agent reliability, browser automation, workflow approval, and AI governance.',
    '- InMail: draft only until exact recipient, text, and approval phrase are confirmed.',
    '- Analytics: capture impressions, profile views, replies, and checkout/intake clicks as evidence, not proof of revenue.',
    '',
    '## First Response Pattern',
    'If a buyer names a concrete repeated failure, propose one workflow hardening pass. If they only show curiosity, send the free setup guide.',
    '',
    `Approval phrase for any send: \`${pack.approvalPhrase}\``,
    '',
  ].join('\n');
}

function renderOkaraChecklist(pack) {
  return [
    '# Okara Setup Checklist',
    '',
    '## Immediate Setup',
    '- Open Okara dashboard.',
    '- Review the CMO strategy, technical audit, competitive landscape, and brand voice docs.',
    '- Connect Google Analytics.',
    '- Connect Google Search Console.',
    '- Screenshot or note the successful GA/GSC connection state.',
    '',
    '## Approval Gate',
    `I need the exact phrase \`${pack.okaraGaGscApprovalPhrase}\` before operating an external Google/Okara UI flow for you.`,
    '',
    '## Why This Matters',
    pack.okaraBrief.setupGap,
    '',
  ].join('\n');
}

function renderSeoGeoConnections(pack) {
  return [
    '# SEO/GEO Data Connections',
    '',
    '## SEO Agent Needs',
    '- Google Analytics traffic and conversion data.',
    '- Google Search Console query, page, crawl, and indexing data.',
    '- Landing page, guide, pricing, blog, and comparison URL inventory.',
    '',
    '## GEO Agent Needs',
    '- Pages that define ThumbGate clearly enough for ChatGPT, Claude, Perplexity, and Grok to cite.',
    '- Evidence-backed comparison pages and topical hubs.',
    '- Medium and owned blog articles that point back to canonical ThumbGate pages.',
    '',
    '## Output Rule',
    '- Do not publish SEO/GEO recommendations as public claims until they are tied to live GA/GSC or source-page evidence.',
    '',
    '## SEO/GEO Backlog',
    ...pack.seoGeoBacklog.flatMap((item) => [
      `### P${item.priority}: ${item.improvement}`,
      `- Source: ${item.source}`,
      `- Output: ${item.output}`,
      '',
    ]),
    `Approval phrase for setup: \`${pack.okaraGaGscApprovalPhrase}\``,
    '',
  ].join('\n');
}

function renderPostEverywhereQueue(pack) {
  return [
    `# Post Everywhere Approval Queue ${pack.date}`,
    '',
    'Status: queued_not_posted',
    '',
    '## Channels',
    ...pack.channelPlan.map((entry) => `- ${entry.channel}: ${entry.status}. ${entry.rule}`),
    '',
    '## Drafts',
    ...pack.promotionDrafts.flatMap((draft) => [
      `### ${draft.channel}`,
      `- Audience: ${draft.audience}`,
      draft.title ? `- Title: ${draft.title}` : null,
      '',
      draft.text,
      '',
    ].filter(Boolean)),
    `Approval phrase before posting anywhere: \`${pack.approvalPhrase}\``,
    '',
  ].join('\n');
}

function renderDailyAutomation(pack) {
  return [
    '# Daily Money + Promotion Automation',
    '',
    '## Local Command',
    '```bash',
    'npm run gtm:okara-automation:write',
    '```',
    '',
    '## Then Review',
    '- EVIDENCE_LEDGER.md',
    '- EXECUTION_BOARD.md',
    '- OUTREACH_APPROVAL_QUEUE.md',
    '- POST_EVERYWHERE_APPROVAL_QUEUE_' + pack.date + '.md',
    '- SEO_GEO_DATA_CONNECTIONS.md',
    '',
    '## Cron/Heartbeat Policy',
    '- It may refresh evidence and draft queues automatically.',
    '- It may not post, send, submit, buy, change billing, or edit public profiles without action-time confirmation.',
    '- It must surface one next money action, not a bundle.',
    '',
    '## Current Next Money Action',
    `- Action: ${pack.nextMoneyAction.action}`,
    `- Why: ${pack.nextMoneyAction.why}`,
    `- Approval phrase: \`${pack.nextMoneyAction.approvalPhrase}\``,
    '',
  ].join('\n');
}

function buildArtifacts(pack) {
  return {
    'EVIDENCE_LEDGER.md': renderEvidenceLedger(pack),
    'EXECUTION_BOARD.md': renderExecutionBoard(pack),
    'BRAND_OPERATING_SYSTEM.md': renderBrandOperatingSystem(pack),
    'STAKEHOLDER_TARGET_MAP.md': renderStakeholderTargetMap(pack),
    'OUTREACH_APPROVAL_QUEUE.md': renderOutreachApprovalQueue(pack),
    [`LINKEDIN_PROMOTION_QUEUE_${pack.date}.md`]: renderLinkedInPromotionQueue(pack),
    'LINKEDIN_PREMIUM_FEATURE_COMMAND_BOARD.md': renderLinkedInPremiumCommandBoard(pack),
    'OKARA_SETUP_CHECKLIST.md': renderOkaraChecklist(pack),
    'SEO_GEO_DATA_CONNECTIONS.md': renderSeoGeoConnections(pack),
    [`POST_EVERYWHERE_APPROVAL_QUEUE_${pack.date}.md`]: renderPostEverywhereQueue(pack),
    'DAILY_MONEY_PROMO_AUTOMATION.md': renderDailyAutomation(pack),
  };
}

function resolveReportDir({ repoRoot = REPO_ROOT, date = normalizeDate(), reportDir = '' } = {}) {
  if (reportDir) {
    return path.resolve(repoRoot, reportDir);
  }
  return path.join(repoRoot, 'reports', 'gtm', `${date}-${DEFAULT_REPORT_SLUG}`);
}

function writeArtifacts(pack, { repoRoot = REPO_ROOT, reportDir = '' } = {}) {
  const targetDir = resolveReportDir({ repoRoot, date: pack.date, reportDir });
  ensureDir(targetDir);
  const artifacts = buildArtifacts(pack);
  for (const [name, content] of Object.entries(artifacts)) {
    fs.writeFileSync(path.join(targetDir, name), content, 'utf8');
  }
  writeJson(path.join(targetDir, 'okara-money-promo-automation.json'), pack);
  return {
    reportDir: targetDir,
    files: [...Object.keys(artifacts), 'okara-money-promo-automation.json'].map((name) => path.join(targetDir, name)),
  };
}

async function run(options = {}) {
  const date = options.date || normalizeDate();
  const evidence = await collectLiveEvidence({ repoRoot: options.repoRoot || REPO_ROOT });
  const pack = buildAutomationPack({
    date,
    evidence,
    generatedAt: evidence.generatedAt,
  });
  const written = options.write
    ? writeArtifacts(pack, { repoRoot: options.repoRoot || REPO_ROOT, reportDir: options.reportDir })
    : null;
  return { pack, written };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = await run(options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log('Okara money + promo automation prepared.');
  console.log(`State: ${result.pack.state}`);
  console.log(`Pipeline byStage: ${JSON.stringify(result.pack.evidenceSnapshot.pipelineByStage)}`);
  console.log(`Stripe status: ${result.pack.evidenceSnapshot.stripeStatus}`);
  console.log(`Next action: ${result.pack.nextMoneyAction.action}`);
  console.log(`Approval phrase: ${result.pack.nextMoneyAction.approvalPhrase}`);
  if (result.written) {
    console.log(`Report dir: ${result.written.reportDir}`);
    for (const file of result.written.files) {
      console.log(`- ${file}`);
    }
  } else {
    console.log('Dry run only. Add --write to create report artifacts.');
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}

module.exports = {
  APPROVAL_PHRASE,
  OKARA_GA_GSC_APPROVAL_PHRASE,
  PUBLIC_APP_ORIGIN,
  REQUIRED_CHANNELS,
  SOURCE_PDFS,
  WEB_SOURCE_INPUTS,
  buildArtifacts,
  buildAutomationPack,
  buildScore,
  buildZaiAccelerationStatus,
  collectLiveEvidence,
  parseArgs,
  resolveReportDir,
  run,
  writeArtifacts,
};
