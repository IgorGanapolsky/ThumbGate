'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-pack-templates-test-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpFeedbackDir;

const {
  PACK_TEMPLATES,
  constructTemplatedPack,
  listPackTemplates,
  ensureContextFs,
} = require('../scripts/contextfs');

test.after(() => {
  fs.rmSync(tmpFeedbackDir, { recursive: true, force: true });
  delete process.env.THUMBGATE_FEEDBACK_DIR;
});

test('PACK_TEMPLATES has expected template names', () => {
  const names = Object.keys(PACK_TEMPLATES);
  assert.ok(names.includes('bug-investigation'));
  assert.ok(names.includes('session-resume'));
  assert.ok(names.includes('sales-call-prep'));
  assert.ok(names.includes('competitor-scan'));
  assert.ok(names.includes('research-brief'));
  assert.ok(names.includes('autoresearch-brief'));
  assert.ok(names.includes('gtm-research'));
});

test('autoresearch template prioritizes holdout proof and reward hacking prevention', () => {
  const template = PACK_TEMPLATES['autoresearch-brief'];

  assert.match(template.queryPrefix, /holdout/);
  assert.match(template.queryPrefix, /proof/);
  assert.match(template.queryPrefix, /reward hacking/);
});

test('listPackTemplates returns all template names', () => {
  const templates = listPackTemplates();
  assert.ok(Array.isArray(templates));
  const names = templates.map((template) => template.name);
  assert.deepEqual(names, Object.keys(PACK_TEMPLATES));
});

test('constructTemplatedPack with valid template returns pack with template field', () => {
  ensureContextFs();
  const pack = constructTemplatedPack({ template: 'bug-investigation', query: 'test error' });
  assert.ok(pack.packId);
  assert.equal(pack.template, 'bug-investigation');
});

test('constructTemplatedPack with invalid template throws', () => {
  assert.throws(
    () => constructTemplatedPack({ template: 'nonexistent-template' }),
    /Unknown pack template/
  );
});

test('each template has required config fields', () => {
  const requiredFields = ['namespaces', 'maxItems', 'maxChars', 'queryPrefix'];
  for (const [name, config] of Object.entries(PACK_TEMPLATES)) {
    for (const field of requiredFields) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(config, field),
        `Template "${name}" missing field "${field}"`
      );
    }
  }
});
