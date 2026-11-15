'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
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
  test(`${page} retires the offer and links to current software plans`, () => {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    assert.match(html, /This offer has been retired/);
    assert.match(html, /free local CLI and self-serve Pro/);
    assert.match(html, /href="\/install"/);
    assert.match(html, /href="\/pricing"/);
    assert.match(html, /name="robots" content="noindex"/);
    assert.doesNotMatch(html, /\$499|Setup Sprint|data-offer-promise|<form|\/go\/diagnostic-pay/);
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
