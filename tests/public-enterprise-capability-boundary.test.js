'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { OFFER_CATALOG } = require('../scripts/revenue-offer-system');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const buyerPages = [
  'public/pricing.html',
  'public/pro.html',
  'public/compare.html',
  'public/guide.html',
  'public/codex-enterprise.html',
  'public/agents-cost-savings.html',
  'public/agent-manager.html',
  'public/compare/claude-code-hooks.html',
  'public/llm-context.md',
];
const capabilitySources = [
  ...buyerPages,
  'src/api/server.js',
  'scripts/seo-gsd.js',
  'bin/cli.js',
];

test('primary buyer pages state the hosted Enterprise availability boundary', () => {
  for (const relativePath of buyerPages) {
    const html = read(relativePath);
    assert.match(
      html,
      /not generally available/i,
      `${relativePath} must state that hosted Enterprise capabilities are not generally available`
    );
  }
});

test('capability generators and runtime receipts preserve the same boundary', () => {
  assert.match(read('src/api/server.js'), /hosted team sync and a hosted org dashboard are not generally available/i);
  assert.match(read('scripts/seo-gsd.js'), /shared hosted lessons are not generally available/i);
  assert.match(read('bin/cli.js'), /hosted team sync and org dashboard are not GA/i);
  assert.match(read('public/llm-context.md'), /org-wide hosted rule library and hosted dashboard are not generally available/i);
});

test('primary buyer pages do not resurrect unconditional hosted Enterprise promises', () => {
  const banned = [
    /Enterprise adds (?:a )?shared hosted lesson/i,
    /Enterprise adds (?:the )?hosted (?:org )?dashboard/i,
    /Enterprise is the hosted (?:rollout lane|dashboard|operator)/i,
    /Enterprise shares the lesson database across the org/i,
    /Pro and Enterprise are month-to-month/i,
    /Everything in Pro, for every developer and agent/i,
  ];

  for (const relativePath of capabilitySources) {
    const html = read(relativePath);
    for (const pattern of banned) {
      assert.doesNotMatch(html, pattern, `${relativePath} contains stale capability copy: ${pattern}`);
    }
  }
});

test('proposal-only expansion prices remain internal catalog truth', () => {
  const pricing = read('public/pricing.html');
  const workflowOps = OFFER_CATALOG.workflow_reliability_operations;
  const pilot = OFFER_CATALOG.enterprise_governance_pilot;
  const enterpriseOps = OFFER_CATALOG.enterprise_reliability_operations;

  assert.equal(workflowOps.priceCents, 300000);
  assert.equal(pilot.priceCents, 1500000);
  assert.equal(enterpriseOps.priceCents, 1000000);
  assert.doesNotMatch(pricing, /\$3,000|\$15,000|\$10,000/);
  assert.match(pricing, /Two paid paths · one product/i);
  assert.match(pricing, /\$19/);
  assert.match(pricing, /\$499/);
});

test('public pricing hides proposal-only Enterprise expansion', () => {
  const pricing = read('public/pricing.html');
  assert.doesNotMatch(pricing, /Enterprise Governance Pilot|Enterprise Reliability Operations/i);
  assert.doesNotMatch(pricing, /workflow-sprint-intake|checkout\/enterprise|checkout\/team/i);
  assert.match(pricing, /Hosted Enterprise capabilities are not generally available/i);
});

test('proposal-only service copy does not make guarantees or fake urgency claims', () => {
  const pricing = read('public/pricing.html');
  assert.doesNotMatch(pricing, /guaranteed (?:savings|incident prevention|outcome)/i);
  assert.doesNotMatch(pricing, /spots (?:left|remaining)/i);
  assert.doesNotMatch(pricing, /today only|limited time/i);
  assert.doesNotMatch(pricing, /24\/7 incident response (?:is included|included)/i);
});
