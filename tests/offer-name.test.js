'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PROMISE = 'One workflow gate, configured and regression-tested. $499 once. Delivered in two business days after access, for a supported failure.';
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

for (const page of ['public/diagnostic.html', 'public/pricing.html']) {
  test(`${page} opens with the Setup Sprint promise, criteria and refund`, () => {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const match = html.match(/<div class="offer-promise" data-offer-promise>([\s\S]*?)<\/div>/);
    assert.ok(match, 'offer-promise block present');
    const text = match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    assert.ok(text.startsWith(PROMISE), 'promise sentence comes first');
    assert.match(text, /Supported failure: one repeated agent mistake in one local workflow/);
    assert.match(text, /Refund: if the failure cannot be reduced to one supported gate, we refund the \$499 order\./);
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
