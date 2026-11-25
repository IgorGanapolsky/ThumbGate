'use strict';

// Default gates for three Siren boundary cases (Anthropic Safeguards, "Measuring and mitigating agent sandbox
// escape with Siren", 24 Nov 2026, https://safeguards.anthropic.com/2026/siren/): the cloud metadata service
// (credentials that are not the task's), container engine and node control APIs, and one irreversible outward
// action seen in our own fleet: withdrawing an App Store review submission.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const gatesEngine = require('../scripts/gates-engine');

const CONFIG = path.join(__dirname, '..', 'config', 'gates', 'default.json');
const PATH_KEYS = ['STATE_PATH', 'STATS_PATH', 'CONSTRAINTS_PATH', 'SESSION_ACTIONS_PATH', 'CUSTOM_CLAIM_GATES_PATH', 'GOVERNANCE_STATE_PATH'];
const ORIGINAL = Object.fromEntries(PATH_KEYS.map((k) => [k, gatesEngine[k]]));
let sandboxDir;
let originalFeedbackDir;

beforeEach(() => {
  sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-siren-gates-'));
  originalFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = path.join(sandboxDir, 'feedback');
  for (const k of PATH_KEYS) gatesEngine[k] = path.join(sandboxDir, `${k.toLowerCase()}.json`);
});

afterEach(() => {
  for (const [k, v] of Object.entries(ORIGINAL)) gatesEngine[k] = v;
  if (originalFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
  else process.env.THUMBGATE_FEEDBACK_DIR = originalFeedbackDir;
  fs.rmSync(sandboxDir, { recursive: true, force: true });
});

const bash = (command) => gatesEngine.evaluateGates('Bash', { command }, CONFIG);
const gateOf = (r) => (r ? r.gate : null);

test('cloud metadata service is blocked from shell and WebFetch', () => {
  for (const cmd of [
    'curl -s http://169.254.169.254/latest/meta-data/iam/security-credentials/',
    'curl -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    'wget -qO- http://169.254.170.2$AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
  ]) {
    const r = bash(cmd);
    assert.equal(gateOf(r), 'cloud-metadata-credential', cmd);
    assert.equal(r.decision, 'deny');
  }
  const web = gatesEngine.evaluateGates('WebFetch', { url: 'http://169.254.169.254/latest/api/token' }, CONFIG);
  assert.equal(gateOf(web), 'cloud-metadata-credential');
});

test('container engine sockets and host-level containers need approval', () => {
  for (const cmd of [
    'curl --unix-socket /var/run/docker.sock http://localhost/containers/json',
    'docker run -v /var/run/docker.sock:/var/run/docker.sock alpine sh',
    'docker run --privileged -it ubuntu bash',
    'docker run --pid=host --rm alpine ps',
    'docker run -v /:/host alpine cat /host/etc/shadow',
    'nsenter -t 1 -m -u -i -n sh',
  ]) {
    assert.equal(gateOf(bash(cmd)), 'container-host-control', cmd);
  }
});

test('node control APIs need approval from shell and from HTTP tools', () => {
  assert.equal(gateOf(bash('curl -k https://10.0.0.5:10250/pods')), 'node-control-api');
  assert.equal(gateOf(bash('curl http://127.0.0.1:2375/containers/json')), 'node-control-api');
  const web = gatesEngine.evaluateGates('WebFetch', { url: 'https://10.0.0.5:10250/pods' }, CONFIG);
  assert.equal(gateOf(web), 'node-control-api');
  assert.equal(web.decision, 'approve');
});

test('searching code for a metadata address is not a metadata call', () => {
  for (const cmd of ['rg -n "169.254.169.254" src', 'grep -r metadata.google.internal .']) {
    assert.notEqual(gateOf(bash(cmd)), 'cloud-metadata-credential', cmd);
  }
});

test('everyday docker use is not caught by the container gate', () => {
  for (const cmd of ['docker ps', 'docker build -t app .', 'docker run --rm -v $(pwd):/app node:22 npm test', 'docker compose up -d']) {
    assert.notEqual(gateOf(bash(cmd)), 'container-host-control', cmd);
  }
});

test('withdrawing an App Store review submission is blocked pending the owner', () => {
  const cases = [
    `curl -X PATCH https://api.appstoreconnect.apple.com/v1/reviewSubmissions/abc -d '{"data":{"type":"reviewSubmissions","id":"abc","attributes":{"canceled":true}}}'`,
    'curl -X DELETE https://api.appstoreconnect.apple.com/v1/appStoreVersionSubmissions/abc',
    'fastlane deliver --submit_for_review --reject_if_possible true',
  ];
  for (const cmd of cases) {
    const r = bash(cmd);
    assert.equal(gateOf(r), 'app-store-review-withdraw', cmd);
    assert.equal(r.decision, 'deny');
    assert.equal(r.requiresAdminOverride, true);
  }
  const mcp = gatesEngine.evaluateGates('mcp__appstore__cancel_review_submission', { id: 'abc' }, CONFIG);
  assert.equal(gateOf(mcp), 'app-store-review-withdraw');
});

test('reading App Store review status stays allowed', () => {
  for (const cmd of [
    'curl -s https://api.appstoreconnect.apple.com/v1/apps/123/reviewSubmissions?limit=10',
    'curl -s https://api.appstoreconnect.apple.com/v1/reviewSubmissions/abc',
  ]) {
    assert.notEqual(gateOf(bash(cmd)), 'app-store-review-withdraw', cmd);
  }
});
