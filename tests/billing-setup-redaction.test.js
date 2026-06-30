const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const billingSetup = path.join(repoRoot, 'scripts', 'billing-setup.js');

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-billing-home-'));
}

function operatorConfigPath(home) {
  return path.join(home, '.config', 'thumbgate', 'operator.json');
}

function runBillingSetup(home, env = {}) {
  return spawnSync(process.execPath, [billingSetup], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      THUMBGATE_BILLING_API_BASE_URL: 'http://127.0.0.1:9',
      ...env,
    },
  });
}

test('billing setup redacts newly generated operator key by default', () => {
  const home = tempHome();
  try {
    const result = runBillingSetup(home);
    assert.equal(result.status, 0, result.stderr);

    const config = JSON.parse(fs.readFileSync(operatorConfigPath(home), 'utf8'));
    assert.match(config.operatorKey, /^tg_op_[0-9a-f]{40}$/);
    assert.equal(result.stdout.includes(config.operatorKey), false, 'stdout must not leak the full operator key');
    assert.match(result.stdout, /THUMBGATE_OPERATOR_KEY = tg_op_[0-9a-f]{2}\.\.\.[0-9a-f]{4} \(redacted\)/);
    assert.match(result.stdout, /THUMBGATE_PRINT_OPERATOR_KEY=1 node bin\/cli\.js billing:setup/);
    assert.match(result.stdout, /railway variables set THUMBGATE_OPERATOR_KEY=<value-from-operator\.json>/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('billing setup reveals operator key only when explicitly requested', () => {
  const home = tempHome();
  try {
    const first = runBillingSetup(home);
    assert.equal(first.status, 0, first.stderr);
    const config = JSON.parse(fs.readFileSync(operatorConfigPath(home), 'utf8'));

    const result = runBillingSetup(home, { THUMBGATE_PRINT_OPERATOR_KEY: '1' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(config.operatorKey));
    assert.match(result.stdout, new RegExp(`railway variables set THUMBGATE_OPERATOR_KEY=${config.operatorKey}`));
    assert.equal(result.stdout.includes('<value-from-operator.json>'), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
