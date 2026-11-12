'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('pricing page and README include runtime governance section with exact attribution and <=2 cited figures', () => {
  const pricing = fs.readFileSync(path.join(ROOT, 'public', 'pricing.html'), 'utf8');
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

  for (const [name, content] of [['pricing.html', pricing], ['README.md', readme]]) {
    assert.match(content, /Governance that runs on every tool call, not paperwork/, `${name} missing section heading`);
    assert.match(content, /Agent register\./, `${name} missing item 1 (Agent register)`);
    assert.match(content, /Cost per task as a control\./, `${name} missing item 2 (Cost per task as a control)`);
    assert.match(content, /Bypass rate\./, `${name} missing item 3 (Bypass rate)`);
    assert.match(content, /Gartner, as cited by Capital One Software/, `${name} missing exact attribution phrase`);
    assert.match(
      content,
      /https:\/\/capitalonesoftware\.com\/blog\/gartner-2026-ai-risk-business-value/,
      `${name} missing source URL`,
    );
    assert.doesNotMatch(content, /real[\s-]?estate/i, `${name} must never mention off-brand domain`);
  }

  const readmeParts = readme.split('### Governance that runs on every tool call, not paperwork');
  assert.ok(readmeParts.length > 1, 'README runtime-governance heading slice missing');
  const readmeSection = readmeParts[1].split('---')[0];
  const pricingParts = pricing.split('id="runtime-governance"');
  assert.ok(pricingParts.length > 1, 'pricing.html #runtime-governance section slice missing');
  const pricingSection = pricingParts[1].split('</section>')[0];

  for (const [label, section] of [['README.md', readmeSection], ['pricing.html', pricingSection]]) {
    const citedStats = section.match(/\b\d+(?:\.\d+)?(?:%|x)\b/gi) || [];
    assert.ok(citedStats.length <= 2, `${label} expected at most 2 cited figures, found ${citedStats.length}`);
  }
});
