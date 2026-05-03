'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MARKETING_DIR = path.join(__dirname, '..', 'docs', 'marketing', 'roo-sunset');
const FILES = [
  'linkedin.md',
  'reddit-r-claudeai.md',
  'threads.md',
  'bluesky.md',
];

test('roo sunset outreach drafts stay evidence-backed and proof-disciplined', () => {
  for (const filename of FILES) {
    const text = fs.readFileSync(path.join(MARKETING_DIR, filename), 'utf8');

    assert.match(text, /^## Evidence/m, `${filename} should declare evidence sources`);
    assert.match(text, /^## Guardrails/m, `${filename} should declare guardrails`);
    assert.match(text, /https:\/\/docs\.roocode\.com\//, `${filename} should cite the official Roo docs`);
    assert.match(text, /\/guides\/roo-code-alternative-cline/, `${filename} should route to the migration guide`);
    assert.match(text, /adapters\/cline\/INSTALL\.md/, `${filename} should keep the exact Cline setup doc available`);
    assert.match(text, /COMMERCIAL_TRUTH\.md/, `${filename} should keep commercial truth nearby`);
    assert.match(text, /VERIFICATION_EVIDENCE\.md/, `${filename} should keep verification evidence nearby`);
    assert.match(text, /Do not claim installs, revenue, or marketplace approval without direct command evidence\./, `${filename} should keep claim guardrails`);
    assert.match(text, /Do not lead with proof links before the buyer confirms pain\./, `${filename} should keep proof timing guardrails`);
  }
});
