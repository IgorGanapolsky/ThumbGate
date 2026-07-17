#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ensureDir } = require('./fs-utils');
const { csvCell, normalizeText, parseReportArgs } = require('./revenue-pack-utils');
const { buildDiagnosticBuyerUrl } = require('./buyer-paths');

const REPO_ROOT = path.resolve(__dirname, '..');
const GENERATED_AT = '2026-05-06T18:40:00.000Z';
const COMMERCIAL_TRUTH_LINK = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md';
const VERIFICATION_EVIDENCE_LINK = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md';

const RETIRED_CATALOG_RECORDS = Object.freeze({
  preventionRuleLibrary: {
    stripeProductId: 'prod_UT6qLfee8Vy18d',
    stripePriceId: 'price_1TUAd2GGBpd520QYpE9TFGfg',
    stripePaymentLinkId: 'plink_1TUAd7GGBpd520QYrYcEP76v',
    status: 'retired_not_public',
    buyerPath: buildDiagnosticBuyerUrl({ source: 'legacy_openclaw_pack', content: 'prevention_rule_library' }),
  },
  reliableGovernanceKit: {
    stripeProductId: 'prod_UT6pEuLvgFiO31',
    stripePriceId: 'price_1TUAbwGGBpd520QYGdYMxFNC',
    stripePaymentLinkId: 'plink_1TUAc2GGBpd520QYF5kmDGS4',
    status: 'retired_not_public',
    buyerPath: buildDiagnosticBuyerUrl({ source: 'legacy_openclaw_pack', content: 'reliable_governance_kit' }),
  },
  restaurantOpsStarter: {
    stripeProductId: 'prod_UT6qOLJzT59iQD',
    stripePriceId: 'price_1TUAdGGGBpd520QYNSzNTiDT',
    stripePaymentLinkId: 'plink_1TUAdJGGBpd520QYRHSxpKLt',
    status: 'retired_not_public',
    buyerPath: buildDiagnosticBuyerUrl({ source: 'legacy_openclaw_pack', content: 'restaurant_ops_starter' }),
  },
  multiAgentGovernance: {
    stripeProductId: 'prod_UT6rz0ShBHYwb2',
    stripePriceId: 'price_1TUAdSGGBpd520QYEno8SvMT',
    stripePaymentLinkId: 'plink_1TUAdWGGBpd520QYTV5G8uYD',
    status: 'retired_not_public',
    buyerPath: buildDiagnosticBuyerUrl({ source: 'legacy_openclaw_pack', content: 'multi_agent_governance' }),
  },
});

function buildKits() {
  return [
    {
      key: 'prevention-rule-library',
      name: 'ThumbGate Prevention Rule Library for OpenClaw',
      priceCents: 4900,
      catalog: RETIRED_CATALOG_RECORDS.preventionRuleLibrary,
      buyer: 'OpenClaw users who already have working agents but need repeat-failure prevention before risky tool calls.',
      promise: 'A copy-ready rule library for common agent failure modes: unsafe writes, stale context, bad customer replies, payment/refund risk, and missing proof.',
      deliverables: [
        '40 prevention-rule prompts grouped by tool risk, customer data, publishing, payments, and agent handoffs.',
        'ThumbGate import checklist for turning a thumbs-down into a durable pre-action check.',
        'Audit worksheet for proving which repeated failure was blocked.',
      ],
      codexPrompt: 'Generate a ThumbGate prevention rule pack for an OpenClaw-style agent. For each rule include: failure pattern, risky action, pre-action question, block condition, evidence required, rollback note, and one test prompt that should trigger the rule. Keep claims limited to preventing known repeated failure modes.',
      organicHook: 'OpenClaw agents are easy to start and hard to trust. These are the ThumbGate prevention rules I would add before letting an agent write files, message customers, or touch payments.',
    },
    {
      key: 'reliable-governance-kit',
      name: 'ThumbGate Reliable Agent Governance Kit',
      priceCents: 9700,
      catalog: RETIRED_CATALOG_RECORDS.reliableGovernanceKit,
      buyer: 'Builders and agencies who need a general OpenClaw-compatible governance starter before shipping client-facing agents.',
      promise: 'A complete self-serve governance kit: rule library, agent registry worksheet, launch checklist, proof report template, and promotion copy.',
      deliverables: [
        'Agent registry template covering owner, tools, MCP servers, permissions, budget, and stale-agent review.',
        'Harness-fit checklist for native vs generic agent runtime decisions.',
        'Proof report template for documenting blocked repeats without claiming full autonomy.',
      ],
      codexPrompt: 'Create a reliable agent governance kit for an OpenClaw-compatible workflow. Include registry fields, permission inventory, ThumbGate prevention rules, test cases, proof report format, and launch copy. Keep every claim tied to known repeated failure prevention and proof artifacts.',
      organicHook: 'Most agent templates skip the trust layer. A safer operating model adds owner, tools, permissions, prevention rules, and proof before the workflow gets promoted.',
    },
    {
      key: 'restaurant-ops-starter',
      name: 'OpenClaw + ThumbGate Restaurant Ops Starter Kit',
      priceCents: 14900,
      catalog: RETIRED_CATALOG_RECORDS.restaurantOpsStarter,
      buyer: 'Restaurant operators and QSR automation builders who want manager-facing agents without unsafe allergy, refund, or public reply decisions.',
      promise: 'Five restaurant workflow specs hardened with ThumbGate: order triage, review reply drafts, inventory alerts, waste reports, and shift handoffs.',
      deliverables: [
        'OpenClaw-compatible workflow specs with inputs, outputs, escalation boundaries, and sample test payloads.',
        'ThumbGate rules for allergy mentions, refund disputes, food-safety complaints, unavailable menu items, and public review replies.',
        'Manager proof checklist for reviewing every risky recommendation before customer-visible action.',
      ],
      codexPrompt: 'Generate five restaurant operations agents for an OpenClaw-compatible pack: order triage, inventory alert, waste report, review reply draft, and shift handoff. Add ThumbGate rules for allergies, refunds, illness, payment, customer PII, and public replies. Every risky action must escalate to a manager.',
      organicHook: 'The first restaurant AI workflow should not be an unreviewed chatbot. It should be a manager-facing workflow with escalation and proof.',
    },
    {
      key: 'multi-agent-governance',
      name: 'Hardened Multi-Agent Governance Workflow Kit',
      priceCents: 14900,
      catalog: RETIRED_CATALOG_RECORDS.multiAgentGovernance,
      buyer: 'AI agencies running multi-agent workflows for clients who need auditability, approvals, and repeatable setup artifacts.',
      promise: 'A client-ready multi-agent governance workflow with registry, handoff rules, approval gates, retrieval checks, and monthly proof report prompts.',
      deliverables: [
        'Multi-agent operating model covering planner, executor, reviewer, publisher, and human approver boundaries.',
        'ThumbGate rules for cross-agent handoff drift, unsafe tool escalation, missing source evidence, and stale context.',
        'Client rollout checklist and recurring governance report outline for retainer upsells.',
      ],
      codexPrompt: 'Build a client-ready multi-agent governance kit for an OpenClaw-compatible agency workflow. Include agent roles, handoff contracts, approval gates, ThumbGate prevention rules, test prompts, audit log fields, and a monthly governance report. Keep the offer focused on reducing repeated known failures.',
      organicHook: 'If an agency sells agent workflows, the moat is not another prompt bundle. It is proof that repeated known failures become rules before the next client run.',
    },
  ];
}

function buildOrganicDraftCalendar(kits = buildKits()) {
  return kits.flatMap((kit, index) => ([
    {
      day: index + 1,
      platform: 'linkedin',
      kit: kit.key,
      post: `${kit.organicHook}\n\nArchived concept: ${kit.name}\nCurrent diagnostic path: ${kit.catalog.buyerPath}`,
    },
    {
      day: index + 1,
      platform: 'threads',
      kit: kit.key,
      post: `${kit.name}: ${kit.promise} Current diagnostic path: ${kit.catalog.buyerPath}`,
    },
  ]));
}

function buildOpenClawGovernancePack(options = {}) {
  const generatedAt = options.generatedAt || GENERATED_AT;
  const kits = buildKits();
  return {
    name: 'thumbgate-openclaw-agent-governance-kits',
    generatedAt,
    status: 'archived-not-for-sale',
    commercialTruth: COMMERCIAL_TRUTH_LINK,
    verificationEvidence: VERIFICATION_EVIDENCE_LINK,
    moneyTruth: {
      checkedAt: generatedAt,
      stripeBalance: '$0 available / $0 pending before new kit launch',
      todayCharges: 0,
    },
    kits,
    organicDraftCalendar: buildOrganicDraftCalendar(kits),
    guardrails: [
      'Do not claim Gumroad sales, Stripe sales, or live OpenClaw runtime validation without command evidence.',
      'Use OpenClaw-compatible or OpenClaw-style unless the exact upstream runtime has been tested for that kit.',
      'Promise prevention of known repeated failure modes, not absolute safety or unsupervised autonomy.',
      'These retired kit prices are catalog history, not current public offers.',
      'Route qualified buyers through the current $499 diagnostic or scope-first $1,500 sprint path.',
    ],
  };
}

function dollars(cents) {
  return `$${Math.round(cents / 100)}`;
}

function renderMarkdown(pack = buildOpenClawGovernancePack()) {
  const lines = [
    '# ThumbGate + OpenClaw Agent Governance Kits',
    '',
    `Updated: ${pack.generatedAt}`,
    '',
    'This is an archived offer-research asset. It is not a current public checkout, proof of sales, or live OpenClaw runtime validation.',
    '',
    '## Money Truth',
    `- Stripe balance before launch: ${pack.moneyTruth.stripeBalance}`,
    `- Today charges before launch: ${pack.moneyTruth.todayCharges}`,
    `- Commercial truth: ${pack.commercialTruth}`,
    `- Verification evidence: ${pack.verificationEvidence}`,
    '',
    '## Positioning',
    'Sell guarded agent kits, not generic prompt packs. ThumbGate is the trust layer: repeated known failures become prevention rules before the next risky action.',
    '',
    '## Retired Catalog Concepts',
  ];

  for (const kit of pack.kits) {
    lines.push(
      '',
      `### ${kit.name}`,
      `- Price: ${dollars(kit.priceCents)}`,
      `- Status: ${kit.catalog.status}`,
      `- Current diagnostic path: ${kit.catalog.buyerPath}`,
      `- Historical Stripe product: ${kit.catalog.stripeProductId}`,
      `- Buyer: ${kit.buyer}`,
      `- Promise: ${kit.promise}`,
      '- Deliverables:',
      ...kit.deliverables.map((item) => `  - ${item}`),
      '- Exact Codex generation prompt:',
      `  ${kit.codexPrompt}`,
      '- Organic draft hook:',
      `  ${kit.organicHook}`,
    );
  }

  lines.push(
    '',
    '## Organic Draft Calendar',
  );
  for (const item of pack.organicDraftCalendar) {
    lines.push('', `### Day ${item.day} - ${item.platform} - ${item.kit}`, item.post);
  }

  lines.push('', '## Guardrails', ...pack.guardrails.map((item) => `- ${item}`));
  return `${lines.join('\n')}\n`;
}

function renderJson(pack = buildOpenClawGovernancePack()) {
  return `${JSON.stringify(pack, null, 2)}\n`;
}

function renderOrganicCsv(pack = buildOpenClawGovernancePack()) {
  const rows = [
    ['day', 'platform', 'kit', 'post'],
    ...pack.organicDraftCalendar.map((item) => [item.day, item.platform, item.kit, item.post]),
  ];
  return `${rows.map((row) => row.map((cell) => csvCell(cell)).join(',')).join('\n')}\n`;
}

function writeOpenClawGovernancePack(pack = buildOpenClawGovernancePack(), options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const docsDir = path.join(repoRoot, 'docs', 'marketing');
  const reportDir = options.reportDir || path.join(repoRoot, 'reports', 'gtm', '2026-05-06-money-today');
  ensureDir(docsDir);
  ensureDir(reportDir);

  const docsMdPath = path.join(docsDir, 'openclaw-agent-governance-kits.md');
  const docsJsonPath = path.join(docsDir, 'openclaw-agent-governance-kits.json');
  const docsCsvPath = path.join(docsDir, 'openclaw-organic-draft-calendar.csv');
  const reportPath = path.join(reportDir, 'operator-close-packet.md');

  const markdown = renderMarkdown(pack);
  const json = renderJson(pack);
  const csv = renderOrganicCsv(pack);

  if (options.writeDocs) {
    fs.writeFileSync(docsMdPath, markdown);
    fs.writeFileSync(docsJsonPath, json);
    fs.writeFileSync(docsCsvPath, csv);
  }

  fs.writeFileSync(path.join(reportDir, 'openclaw-agent-governance-kits.md'), markdown);
  fs.writeFileSync(path.join(reportDir, 'openclaw-agent-governance-kits.json'), json);
  fs.writeFileSync(path.join(reportDir, 'openclaw-organic-draft-calendar.csv'), csv);
  fs.writeFileSync(reportPath, [
    '# Money Today Operator Close Packet',
    '',
    `Updated: ${pack.generatedAt}`,
    '',
    '## Archived Offer Concepts',
    ...pack.kits.map((kit) => `- ${kit.name} - historical ${dollars(kit.priceCents)} - ${kit.catalog.buyerPath}`),
    '',
    '## First Post To Send',
    normalizeText(pack.organicDraftCalendar[0]?.post),
    '',
    '## Truth Labels',
    ...pack.guardrails.map((item) => `- ${item}`),
    '',
  ].join('\n'));

  return {
    docsMdPath: options.writeDocs ? docsMdPath : null,
    docsJsonPath: options.writeDocs ? docsJsonPath : null,
    docsCsvPath: options.writeDocs ? docsCsvPath : null,
    reportPath,
  };
}

function isCliInvocation(argv = process.argv) {
  return path.basename(argv[1] || '') === 'openclaw-agent-governance-kit.js';
}

if (isCliInvocation()) {
  const options = parseReportArgs(process.argv.slice(2));
  const pack = buildOpenClawGovernancePack();
  const written = writeOpenClawGovernancePack(pack, options);
  console.log(JSON.stringify({ name: pack.name, status: pack.status, written }, null, 2));
}

module.exports = {
  GENERATED_AT,
  RETIRED_CATALOG_RECORDS,
  buildKits,
  buildOpenClawGovernancePack,
  buildOrganicDraftCalendar,
  dollars,
  isCliInvocation,
  renderJson,
  renderMarkdown,
  renderOrganicCsv,
  writeOpenClawGovernancePack,
};
