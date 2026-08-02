'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HOME_HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const PRICING_HTML = fs.readFileSync(path.join(ROOT, 'public', 'pricing.html'), 'utf8');
const PRO_HTML = fs.readFileSync(path.join(ROOT, 'public', 'pro.html'), 'utf8');

test('homepage commercial contract offers Pro $19/mo and Diagnostic $499', () => {
  assert.match(HOME_HTML, /Diagnostic Gate/);
  assert.match(HOME_HTML, /\$499 Diagnostic/i);
  assert.match(HOME_HTML, /action="\/go\/diagnostic-pay"/);
  assert.match(HOME_HTML, /\$__SPRINT_DIAGNOSTIC_PRICE_DOLLARS__/);
  assert.match(HOME_HTML, /\/checkout\/pro/);
  assert.match(HOME_HTML, /Start Pro — \$19\/mo/);
  assert.match(HOME_HTML, /Pro · \$19\/mo/);
  assert.doesNotMatch(HOME_HTML, /href="[^"]*workflow-sprint-intake|\/go\/sprint/i);
  assert.match(HOME_HTML, /id="workflow-sprint-intake"[^>]*data-legacy-intake-alias/);
});

test('pricing surfaces Pro self-serve and Diagnostic managed gate together', () => {
  assert.match(PRICING_HTML, /Diagnostic gate|Get Started — \$499 Diagnostic|Cash path/i);
  assert.match(PRICING_HTML, /Diagnostic gate|Get Started — \$499 Diagnostic/i);
  assert.match(PRICING_HTML, /action="\/go\/diagnostic-pay"/);
  assert.match(PRICING_HTML, /\$499/);
  assert.match(PRICING_HTML, /\/checkout\/pro/);
  assert.match(PRICING_HTML, />Start Pro<\/a>/);
  assert.match(PRICING_HTML, /\$19/);
  assert.match(PRICING_HTML, /\$149/);
  assert.doesNotMatch(PRICING_HTML, /workflow-sprint-intake|\/go\/sprint/i);
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
  assert.match(HOME_HTML, /\/checkout\/pro/i);
  assert.match(PRICING_HTML, /\/checkout\/pro/i);
});

test('pricing hides hosted team offers and states the availability boundary', () => {
  assert.match(PRICING_HTML, /Hosted Enterprise capabilities are not generally available/i);
  assert.doesNotMatch(PRICING_HTML, /Hosted team lesson sync|Hosted org dashboard/i);
  assert.doesNotMatch(PRICING_HTML, /\$49\s*(?:<[^>]+>\s*)*\/seat\/mo/i);
  assert.doesNotMatch(PRICING_HTML, /shared team DB/i);
});

test('managed gate promise is bounded and backed by the canonical checkout rail', () => {
  const server = fs.readFileSync(path.join(ROOT, 'src', 'api', 'server.js'), 'utf8');

  assert.match(HOME_HTML, /One configured local gate and its regression test/);
  assert.match(HOME_HTML, /one supported local workflow/i);
  assert.match(HOME_HTML, /order is refunded instead of silently upsold/i);
  assert.match(server, /'diagnostic-pay':/);
  assert.match(server, /requiresPost: true/);
  assert.match(server, /requiresBuyerEmail: true/);
  assert.match(server, /SPRINT_DIAGNOSTIC_CHECKOUT_URL/);
});

test('public enforcement claims match the implemented default and strict boundaries', () => {
  const { spawnSync } = require('node:child_process');
  const runGate = (command, env = {}) => {
    const result = spawnSync('node', ['bin/cli.js', 'gate-check'], {
      cwd: ROOT,
      input: JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command },
        cwd: ROOT,
      }),
      env: { ...process.env, ...env },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const json = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
    return json.hookSpecificOutput?.permissionDecision || 'allow';
  };

  assert.equal(runGate(`echo ghp_${'a'.repeat(36)}`), 'deny');
  assert.equal(runGate('open https://app.apollo.io/billing'), 'deny');
  assert.equal(runGate('git push --force origin main'), 'allow');
  assert.equal(runGate('git push --force origin main', { THUMBGATE_STRICT_ENFORCEMENT: '1' }), 'deny');
  assert.match(HOME_HTML, /secret exfiltration[\s\S]*denied by default/i);
  assert.match(HOME_HTML, /Matching destructive actions warn by default and deny in strict mode/i);
});
