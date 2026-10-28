'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  buildApolloGtmPreviewReport,
  evaluateApolloGtmPreview,
} = require('../scripts/apollo-gtm-preview');

const POLICY = {
  org: 'thumbgate',
  icp: 'teams that run coding agents',
  previewLimit: 10,
  sources: ['maps', 'directory', 'stated'],
};

function decide(action, policy = POLICY) {
  return evaluateApolloGtmPreview(policy, action);
}

function preview(extra = {}, leads = [
  { label: 'local shop', icpReason: 'runs a coding agent and matches the ICP' },
]) {
  return decide({
    point: 'preview.list',
    leads,
    creditsSpent: 0,
    saved: false,
    ...extra,
  });
}

test('map-only is ready and names the refusals', () => {
  const report = buildApolloGtmPreviewReport({ mapOnly: true });
  assert.equal(report.ok, true);
  assert.equal(report.status, 'ready');
  assert.equal(report.name, 'thumbgate-apollo-gtm-preview');
  assert.equal(report.refuses.includes('Spend a credit before approval'), true);
  assert.equal(report.refuses.includes('Grab an email address'), true);
  assert.equal(JSON.stringify(report).includes('http'), false);
  assert.equal(report.evaluation, null);
});

test('a free preview with an ICP reason allows', () => {
  const result = preview();
  assert.equal(result.decision, 'allow');
  assert.equal(result.reason, '');
  assert.equal(result.audit.class, 'user');
  assert.equal(result.audit.exportable, true);
  assert.equal(result.audit.trainingUse, false);
});

test('a preview without a reason, with a credit, or with a save denies', () => {
  assert.equal(preview({}, [{ label: 'local shop', icpReason: '  ' }]).reason, 'missing-icp-reason');
  assert.equal(preview({ creditsSpent: 1 }).reason, 'credits-before-preview');
  assert.equal(preview({ saved: true }).reason, 'preview-does-not-save');
  assert.equal(preview({ enroll: true }).reason, 'sequence-stays-outside');
  assert.equal(preview({ fetch: true }).reason, 'no-fetch');
});

test('a preview row that carries an email denies, and the cap holds', () => {
  assert.equal(preview({}, [{
    label: 'local shop',
    icpReason: 'matches the ICP',
    email: 'person@example.com',
  }]).reason, 'email-on-preview');
  const tooMany = Array.from({ length: 3 }, (_, index) => ({
    label: `shop ${index}`,
    icpReason: 'matches the ICP',
  }));
  assert.equal(decide({
    point: 'preview.list',
    leads: tooMany,
    creditsSpent: 0,
  }, { ...POLICY, previewLimit: 2 }).reason, 'preview-cap');
  assert.equal(decide({
    point: 'preview.list',
    leads: tooMany.slice(0, 2),
    creditsSpent: 0,
  }, { ...POLICY, previewLimit: 2 }).decision, 'allow');
  assert.equal(decide({
    point: 'preview.list',
    leads: tooMany.slice(0, 1),
  }, { ...POLICY, previewLimit: 11 }).reason, 'bad-preview-limit');
});

test('an ICP check allows a reason and denies an email', () => {
  const allowed = decide({ point: 'icp.check', reason: 'runs coding agents all day' });
  assert.equal(allowed.decision, 'allow');
  assert.equal(allowed.audit.class, 'user');
  assert.equal(decide({ point: 'icp.check', reason: '' }).reason, 'missing-icp-reason');
  assert.equal(decide({
    point: 'icp.check',
    reason: 'matches',
    email: 'a@b.example',
  }).reason, 'email-on-preview');
});

test('a cost quote waits, and a credit spend stays outside', () => {
  const quote = decide({
    point: 'cost.quote',
    costCredits: 4,
    costShown: true,
    approved: false,
    creditsSpent: 0,
  });
  assert.equal(quote.decision, 'allow');
  assert.equal(quote.audit.class, 'admin');
  assert.equal(quote.audit.trainingUse, false);

  assert.equal(decide({
    point: 'cost.quote',
    costCredits: 4,
    costShown: false,
    approved: false,
  }).reason, 'cost-not-shown');
  assert.equal(decide({
    point: 'cost.quote',
    costCredits: 0,
    costShown: true,
    approved: true,
  }).reason, 'quote-waits');

  assert.equal(decide({
    point: 'credit.spend',
    costCredits: 4,
    costShown: true,
    approved: false,
  }).reason, 'approval-required');
  assert.equal(decide({
    point: 'credit.spend',
    costCredits: 4,
    costShown: true,
    approved: 'true',
  }).reason, 'approval-required');
  const spent = decide({
    point: 'credit.spend',
    costCredits: 4,
    costShown: true,
    approved: true,
  });
  assert.equal(spent.decision, 'deny');
  assert.equal(spent.reason, 'spend-stays-outside');
  assert.equal(spent.audit.trainingUse, false);
});

test('save, sequence, and email grab deny', () => {
  assert.equal(decide({ point: 'lead.save' }).reason, 'preview-does-not-save');
  assert.equal(decide({ point: 'sequence.enroll' }).reason, 'sequence-stays-outside');
  assert.equal(decide({ point: 'email.grab' }).reason, 'email-grab-refused');
  assert.equal(decide({ point: 'lead.save' }).audit.class, 'admin');
});

test('a source label allows and a fetch denies', () => {
  assert.equal(decide({ point: 'source.name', source: 'maps', fetch: false }).decision, 'allow');
  assert.equal(decide({ point: 'source.name', source: 'directory' }).decision, 'allow');
  assert.equal(decide({ point: 'source.name', source: 'maps', fetch: true }).reason, 'no-fetch');
  assert.equal(decide({ point: 'source.name', source: 'web' }).reason, 'unknown-source');
  assert.equal(decide(
    { point: 'source.name', source: 'stated' },
    { ...POLICY, sources: ['maps'] },
  ).reason, 'unlisted-source');
  assert.equal(decide(
    { point: 'source.name', source: 'maps' },
    { ...POLICY, sources: [] },
  ).reason, 'unlisted-source');
});

test('missing policy, org, ICP, and unknown actions deny', () => {
  assert.equal(evaluateApolloGtmPreview(null, { point: 'preview.list' }).reason, 'missing-policy');
  assert.equal(evaluateApolloGtmPreview(POLICY, null).reason, 'missing-action');
  assert.equal(decide({ point: 'lead.export' }).reason, 'unknown-action');
  assert.equal(decide({ point: 'icp.check', reason: 'fits' }, { ...POLICY, org: '' }).reason, 'missing-org');
  assert.equal(decide({ point: 'icp.check', reason: 'fits' }, { ...POLICY, icp: '' }).reason, 'missing-icp');
});

test('claim text that upgrades, grabs email, or installs MCP fails', () => {
  const safe = buildApolloGtmPreviewReport({
    claim: "don't spend any credits or save anything",
  });
  assert.equal(safe.status, 'ready');

  const report = buildApolloGtmPreviewReport({
    claim: 'Upgrade to Professional to grab their emails, install their MCP, and treat their plan price as a ThumbGate price. Save the leads.',
  });
  assert.equal(report.status, 'fail');
  const messages = report.findings.map((item) => item.message);
  assert.equal(messages.includes('Upgrade to Professional to grab emails'), true);
  assert.equal(messages.includes('Grab an email address'), true);
  assert.equal(messages.includes('Install their MCP'), true);
  assert.equal(messages.includes('Treat their plan price as a ThumbGate price'), true);
  assert.equal(messages.includes('Save leads during a preview'), true);
});

test('the module does not open a network or carry a URL', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'apollo-gtm-preview.js'), 'utf8');
  assert.equal(/https?:\/\//.test(src), false);
  assert.equal(/\bfetch\s*\(/.test(src), false);
  assert.equal(/require\(['"](?:node:)?(?:https?|net|dns)['"]\)/.test(src), false);
  // split, not includes: CodeQL js/incomplete-url-substring-sanitization
  // treats includes() on a hostname as a URL allowlist.
  const vendorHost = 'apollo.' + 'io';
  assert.equal(src.split(vendorHost).length, 1);
});

test('the CLI map is ready and a bad policy file exits 1', () => {
  const root = path.resolve(__dirname, '..');
  const ready = execFileSync(process.execPath, [
    'scripts/apollo-gtm-preview.js',
    '--map-only',
    '--json',
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(JSON.parse(ready).status, 'ready');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-gtm-'));
  const policyPath = path.join(dir, 'policy.json');
  const actionPath = path.join(dir, 'action.json');
  fs.writeFileSync(policyPath, '{');
  fs.writeFileSync(actionPath, JSON.stringify({ point: 'email.grab' }));
  assert.throws(() => execFileSync(process.execPath, [
    'scripts/apollo-gtm-preview.js',
    '--json',
    `--policy=${policyPath}`,
    `--action=${actionPath}`,
  ], { cwd: root, encoding: 'utf8' }));
});

test('the skill names the command and does not tell anyone to call the vendor', () => {
  const skill = fs.readFileSync(path.join(
    __dirname,
    '..',
    '.agents',
    'skills',
    'apollo-gtm-preview-honesty-not-clone',
    'SKILL.md',
  ), 'utf8');
  assert.equal(skill.includes('npx thumbgate apollo-gtm-preview --json --map-only'), true);
  assert.equal(skill.includes('spend-stays-outside'), true);
  const vendorHost = 'apollo.' + 'io';
  assert.equal(skill.split(vendorHost).length, 1);
});
