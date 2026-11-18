'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HOME_HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const PRICING_HTML = fs.readFileSync(path.join(ROOT, 'public', 'pricing.html'), 'utf8');
const PRO_HTML = fs.readFileSync(path.join(ROOT, 'public', 'pro.html'), 'utf8');

test('homepage offers configured self-serve Pro and the free CLI', () => {
  assert.match(HOME_HTML, /href="\/checkout\/pro"/);
  assert.match(HOME_HTML, /__PRO_PRICE_DOLLARS__/);
  assert.match(HOME_HTML, /__PRO_PRICE_LABEL__/);
  assert.match(HOME_HTML, /free local CLI/i);
  assert.doesNotMatch(HOME_HTML, /Setup Sprint|\$499|diagnostic-pay/);
});

test('pricing offers configured self-serve Pro and the free CLI', () => {
  assert.match(PRICING_HTML, /href="\/checkout\/pro"/);
  assert.match(PRICING_HTML, /__PRO_PRICE_DOLLARS__/);
  assert.match(PRICING_HTML, /__PRO_PRICE_LABEL__/);
  assert.match(PRICING_HTML, /free local CLI/i);
  assert.doesNotMatch(PRICING_HTML, /Setup Sprint|\$499|diagnostic-pay|workflow-sprint-intake|\/go\/sprint/i);
  assert.doesNotMatch(PRICING_HTML, /\$1,500|\$3,000|\$10,000|\$15,000/);
});

test('free-tier limits remain code truth without crowding the cash path', () => {
  const { FREE_TIER_LIMITS, FREE_TIER_MAX_GATES } = require('../scripts/rate-limiter');

  assert.equal(FREE_TIER_LIMITS.capture_feedback.daily, 2);
  assert.equal(FREE_TIER_LIMITS.capture_feedback.lifetime, 10);
  assert.equal(FREE_TIER_MAX_GATES, 3);
  assert.doesNotMatch(HOME_HTML, /2 captures\/day|10 total|3 active prevention rules/i);
  assert.doesNotMatch(PRICING_HTML, /2 captures\/day|10 total|3 active prevention rules/i);
});

test('Pro detail stays code-backed and is linked from primary cash paths', () => {
  const server = fs.readFileSync(path.join(ROOT, 'src', 'api', 'server.js'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

  assert.match(PRO_HTML, /personal local dashboard/i);
  assert.match(PRO_HTML, /DPO/i);
  assert.match(server, /'\/v1\/dpo\/export'/);
  assert.ok(pkg.files.includes('public/dashboard.html'));
  // Pro removed from public buying path
  // Pro removed from public buying path
});

test('pricing hides hosted team offers and states the availability boundary', () => {
  assert.match(PRICING_HTML, /Shared hosting, SSO, compliance packaging, and organization-wide rollout are not generally available/i);
  assert.doesNotMatch(PRICING_HTML, /Hosted team lesson sync|Hosted org dashboard/i);
  assert.doesNotMatch(PRICING_HTML, /\$49\s*(?:<[^>]+>\s*)*\/seat\/mo/i);
  assert.doesNotMatch(PRICING_HTML, /shared team DB/i);
});

test('homepage Pro promise excludes managed services while legacy checkout remains email gated', () => {
  const server = fs.readFileSync(path.join(ROOT, 'src', 'api', 'server.js'), 'utf8');

  assert.match(HOME_HTML, /Pro adds recall, dashboard, adapters, and exports/);
  assert.doesNotMatch(HOME_HTML, /managed implementation|two business days/i);
  assert.doesNotMatch(HOME_HTML, /order is refunded/i);
  assert.match(server, /'diagnostic-pay':/);
  assert.match(server, /requiresPost: true/);
  assert.match(server, /requiresBuyerEmail: true/);
  assert.match(server, /SPRINT_DIAGNOSTIC_CHECKOUT_URL/);
});

test('public enforcement claims match the implemented default and strict boundaries', (t) => {
  const { spawnSync } = require('node:child_process');
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'landing-claims-gate-'));
  t.after(() => fs.rmSync(feedbackDir, { recursive: true, force: true }));
  // Pin enforcement mode so an operator shell with THUMBGATE_STRICT_ENFORCEMENT=1
  // (common after never-spend hardening) cannot flip the default-mode assertion.
  const baseEnv = {
    ...process.env,
    THUMBGATE_STRICT_ENFORCEMENT: '',
    THUMBGATE_FEEDBACK_DIR: feedbackDir,
    THUMBGATE_STATE_DIR: feedbackDir,
    NODE_TEST_CONTEXT: 'true',
  };
  const runGate = (command, env = {}) => {
    const result = spawnSync('node', ['bin/cli.js', 'gate-check'], {
      cwd: ROOT,
      input: JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command },
        cwd: ROOT,
      }),
      env: { ...baseEnv, ...env },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const json = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
    return json.hookSpecificOutput?.permissionDecision || 'allow';
  };

  assert.equal(runGate(`echo ghp_${'a'.repeat(36)}`), 'deny');
  // Catastrophic commands are hard-floor denies on a default install.
  for (const command of [
    'git push --force origin main',
    'git reset --hard HEAD~5',
    'git clean -fd',
    'rm -rf ~/',
    'rm -rf /',
    'psql -c "DROP TABLE users"',
  ]) {
    assert.equal(runGate(command), 'deny', command);
  }
  // Ordinary flagged actions still warn by default and deny in strict mode.
  assert.equal(runGate('npm publish'), 'allow');
  assert.equal(runGate('npm publish', { THUMBGATE_STRICT_ENFORCEMENT: '1' }), 'deny');
  assert.match(HOME_HTML, /secret exfiltration[\s\S]*denied by default/i);
  assert.match(HOME_HTML, /denied by default\. Other matching destructive actions warn by default and deny in strict mode/i);
  assert.match(PRICING_HTML, /Blocked by default: force-push/i);
});

test('founder 30-day proof page stays a founder audit, not a customer story', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'guides', 'founder-30-day-proof.html'), 'utf8');
  assert.match(html, /15 risky actions stopped/);
  assert.match(html, /Secret in a command · 9/);
  assert.match(html, /Force-push · 5/);
  assert.match(html, /Repeated mistake · 1/);
  assert.match(html, /not a customer/);
  assert.match(html, /git push --force origin main/);
  assert.doesNotMatch(html, /15,?000|our customer|Acme Corp|support@thumbgate\.ai|ghp_|sk-ant-/i);
  assert.doesNotMatch(html, /top 5|fourth category|fifth category/i);
});
