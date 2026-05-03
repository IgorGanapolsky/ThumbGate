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

test('roo migration guide keeps owned conversion paths and machine-readable FAQ proof', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'guides', 'roo-code-alternative-cline.html'), 'utf8');

  assert.match(page, /"@type": "FAQPage"/, 'guide should expose FAQ schema');
  assert.match(page, /utm_campaign=roo_migration_setup_guide/, 'guide should route to the hosted setup path');
  assert.match(page, /utm_campaign=roo_migration_install_doc/, 'guide should preserve the exact install doc');
  assert.match(page, /utm_campaign=roo_migration_workflow_sprint/, 'guide should expose the sprint conversion path');
  assert.match(page, /COMMERCIAL_TRUTH\.md/, 'guide should link commercial truth after pain is explicit');
  assert.match(page, /VERIFICATION_EVIDENCE\.md/, 'guide should link verification evidence after pain is explicit');
});
