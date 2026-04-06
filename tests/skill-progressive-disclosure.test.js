const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-spd-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

const sp = require('../scripts/skill-packs');

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  // Clean up test skill packs
  for (const name of ['test-factory-pack', 'graphql-api', 'test-res-pack']) {
    const dir = path.join(sp.SKILL_PACKS_DIR, name);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    const f = path.join(sp.SKILL_PACKS_DIR, `${name}.json`);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
});

// === L3 Resource Loading ===
test('addSkillResource creates reference file', () => {
  const r = sp.addSkillResource('stripe-integration', 'webhook-guide.md', '# Webhook Guide\n\nAlways verify signatures.');
  assert.equal(r.name, 'webhook-guide.md');
  assert.ok(r.sizeBytes > 0);
  assert.ok(fs.existsSync(r.path));
});

test('listSkillResources returns added resources', () => {
  const resources = sp.listSkillResources('stripe-integration');
  assert.ok(resources.length >= 1);
  assert.ok(resources.some((r) => r.name === 'webhook-guide.md'));
});

test('loadSkillResource loads content', () => {
  const r = sp.loadSkillResource('stripe-integration', 'webhook-guide.md');
  assert.ok(r);
  assert.equal(r.name, 'webhook-guide.md');
  assert.ok(r.content.includes('Webhook Guide'));
  assert.ok(r.sizeBytes > 0);
});

test('loadSkillResource returns null for missing resource', () => {
  assert.equal(sp.loadSkillResource('stripe-integration', 'nonexistent.md'), null);
});

test('loadSkillResource returns null for missing pack', () => {
  assert.equal(sp.loadSkillResource('nonexistent-pack', 'file.md'), null);
});

test('listSkillResources returns empty for pack without resources', () => {
  assert.deepEqual(sp.listSkillResources('nonexistent-pack'), []);
});

test('addSkillResource creates multiple resources', () => {
  sp.addSkillResource('stripe-integration', 'api-spec.json', '{"openapi":"3.0"}');
  const resources = sp.listSkillResources('stripe-integration');
  assert.ok(resources.length >= 2);
});

// === Skill Factory ===
test('generateSkillPack creates pack from lessons', () => {
  const pack = sp.generateSkillPack({
    domain: 'graphql-api',
    lessons: ['Always validate query depth to prevent DoS', 'Never expose internal IDs in public schema', 'Always use DataLoader for N+1 prevention'],
    description: 'GraphQL API best practices',
    triggers: ['graphql', 'query', 'mutation', 'resolver'],
  });
  assert.equal(pack.name, 'graphql-api');
  assert.equal(pack.rules.length, 3);
  assert.ok(/^always/i.test(pack.rules[0]));
  assert.ok(/^never/i.test(pack.rules[1]));
  assert.ok(pack.registeredAt);
});

test('generateSkillPack converts failure lessons to NEVER rules', () => {
  const pack = sp.generateSkillPack({
    domain: 'test-factory-pack',
    lessons: ['deployed without running tests — broke production', 'forgot to check CI status before merge'],
  });
  assert.ok(pack.rules.every((r) => /^(NEVER|ALWAYS)/i.test(r)));
});

test('generateSkillPack preserves existing NEVER/ALWAYS prefix', () => {
  const pack = sp.generateSkillPack({
    domain: 'test-factory-pack',
    lessons: ['NEVER skip code review', 'ALWAYS run linter before commit'],
  });
  assert.equal(pack.rules[0], 'NEVER skip code review');
  assert.equal(pack.rules[1], 'ALWAYS run linter before commit');
});

test('generateSkillPack infers triggers from domain', () => {
  const pack = sp.generateSkillPack({ domain: 'react-testing', lessons: ['Always test components in isolation'] });
  assert.ok(pack.triggers.includes('react-testing'));
  assert.ok(pack.triggers.includes('react'));
  assert.ok(pack.triggers.includes('testing'));
});

test('generateSkillPack is retrievable after creation', () => {
  sp.generateSkillPack({ domain: 'test-res-pack', lessons: ['Rule 1'] });
  const pack = sp.getSkillPack('test-res-pack');
  assert.ok(pack);
  assert.equal(pack.rules.length, 1);
});

test('generateSkillPack throws without domain', () => {
  assert.throws(() => sp.generateSkillPack({ lessons: ['x'] }), /domain/);
});

test('generateSkillPack throws without lessons', () => {
  assert.throws(() => sp.generateSkillPack({ domain: 'x', lessons: [] }), /lesson/);
});

// === Token Metrics ===
test('measureSkillTokens returns L1/L2/L3 breakdown', () => {
  const m = sp.measureSkillTokens('stripe-integration');
  assert.ok(m);
  assert.equal(m.packName, 'stripe-integration');
  assert.ok(m.l1.chars > 0);
  assert.ok(m.l1.estimatedTokens > 0);
  assert.ok(m.l2.chars > 0);
  assert.ok(m.l2.ruleCount >= 5);
  assert.ok(m.l3.chars >= 0); // may have resources from earlier tests
  assert.ok(m.total.chars > 0);
  assert.ok(m.disclosureSavings > 0);
});

test('measureSkillTokens L1 is much smaller than total', () => {
  const m = sp.measureSkillTokens('stripe-integration');
  assert.ok(m.l1.chars < m.total.chars, 'L1 should be smaller than total');
  assert.ok(m.disclosureSavings > 50, 'progressive disclosure should save >50%');
});

test('measureSkillTokens returns null for missing pack', () => {
  assert.equal(sp.measureSkillTokens('nonexistent'), null);
});

test('measureSkillTokens includes resource count', () => {
  const m = sp.measureSkillTokens('stripe-integration');
  assert.ok(typeof m.l3.resourceCount === 'number');
});
