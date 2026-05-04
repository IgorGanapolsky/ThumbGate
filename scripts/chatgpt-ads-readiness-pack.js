#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SOURCE = Object.freeze({
  searchEngineLandUrl: 'https://searchengineland.com/advertisers-test-chatgpt-ads-manager-475114',
  openAiAdsHelpUrl: 'https://help.openai.com/articles/20001047-ads-in-chatgpt',
  openAiAdvertisersUrl: 'https://openai.com/advertisers',
  title: 'Advertisers test ChatGPT Ads Manager',
  observedAt: '2026-04-22',
});

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeOptions(raw = {}) {
  return {
    offer: normalizeText(raw.offer) || 'ThumbGate Pro and Workflow Hardening Sprint',
    audience: normalizeText(raw.audience) || 'AI coding teams and developers comparing agent governance tools',
    budget: parseNumber(raw.budget || raw['test-budget'], 500),
    keywords: splitList(raw.keywords || raw.queries).length
      ? splitList(raw.keywords || raw.queries)
      : [
        'AI coding agent keeps repeating mistakes',
        'Claude Code pre tool use hook',
        'Cursor agent guardrails',
        'AI agent verification before PR',
        'agent governance for coding teams',
      ],
    proofLinks: splitList(raw.proofLinks || raw['proof-links']).length
      ? splitList(raw.proofLinks || raw['proof-links'])
      : [
        'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md',
        'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md',
      ],
  };
}

function buildAdGroups(options) {
  return [
    {
      id: 'agent-governance-intent',
      theme: 'developers asking how to make AI coding agents safer',
      keywords: options.keywords.filter((keyword) => /agent|guardrail|governance|verification/i.test(keyword)).slice(0, 8),
      landingPage: 'https://thumbgate.ai/guide?utm_source=chatgpt_ads&utm_medium=paid_ai&utm_campaign=agent_governance_intent',
      primaryCta: 'Install the proof-backed guide',
    },
    {
      id: 'workflow-hardening-intent',
      theme: 'teams describing repeated autonomous-agent workflow failures',
      keywords: [
        'AI agent made same mistake again',
        'coding agent opened bad PR',
        'agent changed production without approval',
        'AI workflow hardening sprint',
      ],
      landingPage: 'https://thumbgate.ai/?utm_source=chatgpt_ads&utm_medium=paid_ai&utm_campaign=workflow_hardening_intent#workflow-sprint-intake',
      primaryCta: 'Book one workflow hardening sprint',
    },
  ];
}

function buildCreative(options) {
  return [
    {
      id: 'proof-before-pr',
      headline: 'Stop AI agents before repeat mistakes become PRs.',
      body: 'ThumbGate turns feedback into pre-action gates for Claude Code, Cursor, Codex, Gemini CLI, and MCP agents. Require proof before risky tool calls or completion claims.',
      proofRequired: options.proofLinks,
    },
    {
      id: 'workflow-sprint',
      headline: 'One repeated agent failure. One hardened workflow.',
      body: 'Use ThumbGate to capture the mistake, retrieve the lesson, enforce the gate, and show verification evidence before the next autonomous change.',
      proofRequired: options.proofLinks,
    },
  ];
}

function buildMeasurementPlan(options) {
  return {
    budget: options.budget,
    primaryConversion: 'workflow_sprint_intake_or_pro_checkout_start',
    guardrailMetrics: [
      { id: 'landing_claim_proof_rate', target: '1.00' },
      { id: 'cost_per_qualified_intake', target: '<= budget / 2' },
      { id: 'proof_link_click_rate', target: '>= 0.05' },
      { id: 'unsupported_ad_claims', target: '0' },
    ],
    attributionParams: {
      utm_source: 'chatgpt_ads',
      utm_medium: 'paid_ai',
      utm_campaign: 'agent_governance_or_workflow_hardening',
    },
  };
}

function buildChatgptAdsReadinessPack(rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  const adGroups = buildAdGroups(options);
  return {
    name: 'thumbgate-chatgpt-ads-readiness-pack',
    source: SOURCE,
    status: 'ready_for_interest_signup',
    offer: options.offer,
    audience: options.audience,
    strategy: {
      channelThesis: 'If ChatGPT Ads Manager becomes self-serve, high-intent conversational queries can capture developers at the moment they are asking how to trust or govern AI agents.',
      trustBoundary: 'OpenAI states ads are separate from answers and clearly labeled, so the campaign must win with proof-backed landing pages rather than implying answer influence.',
      firstMove: 'Submit advertiser interest, prepare exact-match intent clusters, and route traffic to guide or workflow sprint pages with proof links.',
    },
    adGroups,
    creative: buildCreative(options),
    measurement: buildMeasurementPlan(options),
    launchChecklist: [
      'Submit interest at openai.com/advertisers.',
      'Create a ChatGPT ads UTM namespace before first spend.',
      'Use guide landing page for self-serve developer intent.',
      'Use workflow sprint intake for high-risk team workflow pain.',
      'Block unsupported claims in ad copy and landing pages.',
      'Compare paid AI traffic against organic AI-search visibility before scaling budget.',
    ],
    marketingAngle: {
      headline: 'ChatGPT ads are a paid surface for the exact moment developers ask how to trust agents.',
      subhead: 'ThumbGate should be ready with proof-backed copy, intent clusters, and conversion routes before self-serve inventory gets crowded.',
      replyDraft: 'If ChatGPT Ads Manager becomes self-serve, ThumbGate should test it early but stay evidence-first: bid on agent-governance pain, route to the setup guide or workflow sprint, and never imply ads influence ChatGPT answers. The wedge is proof-backed trust at the moment someone asks how to make agents safer.',
    },
  };
}

function formatChatgptAdsReadinessPack(report) {
  const lines = [
    '',
    'ThumbGate ChatGPT Ads Readiness Pack',
    '-'.repeat(38),
    `Status  : ${report.status}`,
    `Offer   : ${report.offer}`,
    `Audience: ${report.audience}`,
    `Source  : ${report.source.searchEngineLandUrl}`,
    '',
    'Ad groups:',
  ];
  for (const group of report.adGroups) {
    lines.push(`  - ${group.id}: ${group.theme}`);
    lines.push(`    Landing: ${group.landingPage}`);
  }
  lines.push('', 'Launch checklist:');
  for (const item of report.launchChecklist) lines.push(`  - ${item}`);
  lines.push('', `Reply draft: ${report.marketingAngle.replyDraft}`, '');
  return `${lines.join('\n')}\n`;
}

function writeChatgptAdsReadinessPack(outputDir = path.join(__dirname, '..', 'docs', 'marketing'), options = {}) {
  const report = buildChatgptAdsReadinessPack(options);
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, 'chatgpt-ads-readiness-pack.json');
  const markdownPath = path.join(outputDir, 'chatgpt-ads-readiness-pack.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, formatChatgptAdsReadinessPack(report));
  return { report, jsonPath, markdownPath };
}

module.exports = {
  SOURCE,
  buildAdGroups,
  buildChatgptAdsReadinessPack,
  buildCreative,
  buildMeasurementPlan,
  formatChatgptAdsReadinessPack,
  normalizeOptions,
  writeChatgptAdsReadinessPack,
};

if (require.main === module) {
  const { jsonPath, markdownPath } = writeChatgptAdsReadinessPack();
  console.log(JSON.stringify({ jsonPath, markdownPath }, null, 2));
}
