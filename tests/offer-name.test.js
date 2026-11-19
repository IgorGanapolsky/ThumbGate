'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PROMISE = 'The outcome: that mistake is blocked before the tool runs, with a regression test that proves it.';
const RETIRED_NAMES = [
  'Enterprise Workflow Gate',
  'Managed AI Agent Workflow Gate',
  'Managed Workflow Gate',
  'Managed diagnostic',
  'Workflow Hardening Sprint',
  'Setup sprint',
];

function listFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else if (/\.(html|md|txt|json|xml)$/.test(entry.name)) out.push(full);
  }
  return out;
}

for (const page of ['public/diagnostic.html']) {
  test(`${page} opens with the Setup Sprint promise, criteria and refund`, () => {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const match = html.match(/<ul class="offer-promise offer-points" data-offer-promise>([\s\S]*?)<\/ul>/);
    assert.ok(match, 'offer-promise block present');
    const text = match[1].split('<').map((part) => part.slice(part.indexOf('>') + 1)).join(' ').replace(/\s+/g, ' ').trim();
    assert.ok(text.startsWith(PROMISE), 'the outcome comes first');
    assert.match(text, /The guarantee: if we can't turn it into a gate, you get the \$499 back\./);
    assert.match(text, /The speed: two business days, counted from when we have access and your workflow materials\./);
    assert.match(text, /Your part: a short intake and one 60-minute working review\./);
    assert.doesNotMatch(text, /30 minutes/, 'the buyer effort is the 60-minute review, not a shorter number');
  });
}

test('the public site and AI-discovery files use only the name Setup Sprint', () => {
  const files = [
    ...listFiles(path.join(ROOT, 'public')),
    ...listFiles(path.join(ROOT, '.well-known')),
    path.join(ROOT, 'README.md'),
  ];
  const hits = [];
  for (const file of files) {
    const body = fs.readFileSync(file, 'utf8');
    for (const name of RETIRED_NAMES) {
      if (body.includes(name)) hits.push(`${path.relative(ROOT, file)}: ${name}`);
    }
  }
  assert.deepEqual(hits, []);
});


test('pricing replaces the Setup Sprint promise with configured Pro checkout', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/pricing.html'), 'utf8');
  assert.match(html, /__PRO_PRICE_DOLLARS__/);
  assert.match(html, /__PRO_PRICE_LABEL__/);
  assert.match(html, /href="\/checkout\/pro"/);
  assert.doesNotMatch(html, /\$499|Setup Sprint|data-offer-promise|diagnostic-pay/);
});
