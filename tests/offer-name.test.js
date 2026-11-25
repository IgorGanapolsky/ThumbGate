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
  'Setup Sprint',
];

function listFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else if (/\.(html|md|txt|json|xml)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('the public site and AI-discovery files never name a retired offer (the $499 Setup Sprint retired 2026-11-25)', () => {
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


test('pricing shows configured Pro checkout and no retired Setup Sprint promise', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/pricing.html'), 'utf8');
  assert.match(html, /__PRO_PRICE_DOLLARS__/);
  assert.match(html, /__PRO_PRICE_LABEL__/);
  assert.match(html, /href="\/checkout\/pro"/);
  assert.doesNotMatch(html, /\$499|Setup Sprint|data-offer-promise|diagnostic-pay/);
});
