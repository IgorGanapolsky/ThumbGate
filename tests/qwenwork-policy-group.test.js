'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  buildQwenWorkPolicyGroupReport,
  evaluatePolicyGroup,
} = require('../scripts/qwenwork-policy-group');

const POLICY = {
  org: 'thumbgate',
  directory: 'entra',
  models: ['local-gate'],
  skills: ['approved-skill'],
  connectors: ['approved-connector'],
  suites: ['approved-suite'],
  trustedDevices: ['laptop-1'],
  trustedNetworks: ['office'],
  sensitiveWords: ['secret-token'],
  imChannels: ['internal'],
  usageLimit: 10,
  allowByokTraining: false,
  branding: 'ThumbGate',
};

function decide(action, policy = POLICY) {
  return evaluatePolicyGroup(policy, action);
}

test('map-only is ready and names the refusals', () => {
  const report = buildQwenWorkPolicyGroupReport({ mapOnly: true });
  assert.equal(report.ok, true);
  assert.equal(report.status, 'ready');
  assert.equal(report.refuses.includes('Buy Enterprise Premium seats'), true);
  assert.equal(report.refuses.includes('Install DingTalk, WeCom, or Feishu'), true);
  assert.equal(JSON.stringify(report).includes('http'), false);
});

test('an unapproved skill denies and an approved skill on a trusted device allows', () => {
  const denied = decide({ point: 'skill.install', skill: 'other-skill', device: 'laptop-1' });
  assert.equal(denied.decision, 'deny');
  assert.equal(denied.reason, 'unapproved-skill');
  assert.equal(denied.audit.class, 'admin');
  assert.equal(denied.audit.exportable, true);
  assert.equal(denied.audit.trainingUse, false);

  const allowed = decide({ point: 'skill.install', skill: 'approved-skill', device: 'laptop-1' });
  assert.equal(allowed.decision, 'allow');
  assert.equal(allowed.audit.class, 'admin');
  assert.equal(allowed.audit.trainingUse, false);
});

test('unapproved model, connector, and suite deny', () => {
  assert.equal(decide({ point: 'model.invoke', model: 'other', device: 'laptop-1', network: 'office' }).reason, 'unapproved-model');
  assert.equal(decide({ point: 'connector.install', connector: 'other', device: 'laptop-1' }).reason, 'unapproved-connector');
  assert.equal(decide({ point: 'suite.install', suite: 'other', device: 'laptop-1' }).reason, 'unapproved-suite');
});

test('usage over the limit denies and the exact limit allows a zero increment', () => {
  const over = decide({ point: 'usage.record', used: 8, units: 3 });
  assert.equal(over.decision, 'deny');
  assert.equal(over.reason, 'usage-limit');
  assert.equal(over.audit.class, 'user');

  const atLimit = decide({ point: 'usage.record', used: 10, units: 0 });
  assert.equal(atLimit.decision, 'allow');

  const invokeAtCap = decide({
    point: 'model.invoke',
    model: 'local-gate',
    device: 'laptop-1',
    network: 'office',
    used: 10,
  });
  assert.equal(invokeAtCap.reason, 'usage-limit');
});

test('a sensitive word and an unknown IM channel deny', () => {
  const word = decide({
    point: 'model.invoke',
    model: 'local-gate',
    device: 'laptop-1',
    network: 'office',
    text: 'contains SECRET-TOKEN inside',
  });
  assert.equal(word.reason, 'sensitive-word');
  assert.equal(word.audit.class, 'ai');

  const channel = decide({ point: 'im.send', channel: 'public-chat', device: 'laptop-1', network: 'office' });
  assert.equal(channel.reason, 'unknown-im-channel');
  assert.equal(channel.audit.class, 'ai');

  const sent = decide({ point: 'im.send', channel: 'internal', device: 'laptop-1', network: 'office' });
  assert.equal(sent.decision, 'allow');
});

test('trainingUse is true only for an allowed BYOK action with the policy flag', () => {
  const policy = { ...POLICY, allowByokTraining: true };
  const allowed = evaluatePolicyGroup(policy, {
    point: 'model.invoke',
    model: 'local-gate',
    device: 'laptop-1',
    network: 'office',
    byok: true,
  });
  assert.equal(allowed.decision, 'allow');
  assert.equal(allowed.audit.trainingUse, true);
  assert.equal(allowed.audit.exportable, true);

  const denied = evaluatePolicyGroup(policy, {
    point: 'model.invoke',
    model: 'other',
    byok: true,
  });
  assert.equal(denied.audit.trainingUse, false);

  const notByok = decide({
    point: 'model.invoke',
    model: 'local-gate',
    device: 'laptop-1',
    network: 'office',
    byok: true,
  });
  assert.equal(notByok.audit.trainingUse, false);
});

test('missing policy, missing org, unknown action, and refused directories deny', () => {
  assert.equal(evaluatePolicyGroup(null, { point: 'model.invoke' }).reason, 'missing-policy');
  assert.equal(evaluatePolicyGroup([], { point: 'model.invoke' }).reason, 'missing-policy');
  assert.equal(decide({ point: 'model.invoke' }, { ...POLICY, org: '  ' }).reason, 'missing-org');
  assert.equal(decide({ point: 'billing.charge' }).reason, 'unknown-action');
  assert.equal(decide({ point: 'device.join', device: 'laptop-1' }, { ...POLICY, directory: 'Feishu' }).reason, 'refused-directory');
  assert.equal(decide({ point: 'device.join', device: 'laptop-1' }, { ...POLICY, directory: 'okta' }).reason, 'unknown-directory');
});

test('untrusted device and network deny, and a named network with an empty list denies', () => {
  assert.equal(decide({ point: 'device.join', device: 'phone' }).reason, 'untrusted-device');
  assert.equal(decide({
    point: 'model.invoke',
    model: 'local-gate',
    device: 'laptop-1',
    network: 'cafe',
  }).reason, 'untrusted-network');
  const openNetwork = { ...POLICY, trustedNetworks: [] };
  assert.equal(evaluatePolicyGroup(openNetwork, {
    point: 'im.send',
    channel: 'internal',
    device: 'laptop-1',
    network: 'cafe',
  }).reason, 'untrusted-network');
});

test('brand.apply allows a label and denies a clone', () => {
  assert.equal(decide({ point: 'brand.apply' }).decision, 'allow');
  assert.equal(decide({ point: 'brand.apply' }, { ...POLICY, branding: '' }).reason, 'missing-branding');
  assert.equal(decide({ point: 'brand.apply', clone: true }).reason, 'white-label-clone');
  assert.equal(decide({ point: 'brand.apply', packageApp: true }).reason, 'white-label-clone');
});

test('claim text that buys seats or installs their directory fails', () => {
  const report = buildQwenWorkPolicyGroupReport({
    claim: 'buy Enterprise Premium seats and install DingTalk',
  });
  assert.equal(report.status, 'fail');
  const messages = report.findings.map((item) => item.message);
  assert.equal(messages.includes('Buy Enterprise Premium seats'), true);
  assert.equal(messages.includes('Install DingTalk, WeCom, or Feishu'), true);
});

test('the module does not open a network or carry a URL', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'qwenwork-policy-group.js'), 'utf8');
  assert.equal(/https?:\/\//.test(src), false);
  assert.equal(/\bfetch\s*\(/.test(src), false);
  assert.equal(/require\(['"](?:node:)?(?:https?|net|dns)['"]\)/.test(src), false);
  assert.equal(src.includes('alibabacloud.com'), false);
});

test('the CLI map is ready and a bad policy file exits 1', () => {
  const root = path.resolve(__dirname, '..');
  const ready = execFileSync(process.execPath, [
    'scripts/qwenwork-policy-group.js',
    '--map-only',
    '--json',
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(JSON.parse(ready).status, 'ready');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwenwork-policy-'));
  const policyPath = path.join(dir, 'policy.json');
  const actionPath = path.join(dir, 'action.json');
  fs.writeFileSync(policyPath, '{');
  fs.writeFileSync(actionPath, JSON.stringify({ point: 'device.join', device: 'laptop-1' }));
  assert.throws(() => execFileSync(process.execPath, [
    'scripts/qwenwork-policy-group.js',
    '--json',
    `--policy=${policyPath}`,
    `--action=${actionPath}`,
  ], { cwd: root, encoding: 'utf8' }));
});
