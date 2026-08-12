'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HOME_HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const PRICING_HTML = fs.readFileSync(path.join(ROOT, 'public', 'pricing.html'), 'utf8');
const PRO_HTML = fs.readFileSync(path.join(ROOT, 'public', 'pro.html'), 'utf8');

test('homepage commercial contract offers Pro $19/mo as the sole paid path', () => {
  assert.doesNotMatch(HOME_HTML, /action="\/go\/diagnostic-pay"/);
  assert.doesNotMatch(HOME_HTML, /\$499/);
  assert.doesNotMatch(HOME_HTML, /sprint_diagnostic/);
  assert.match(HOME_HTML, /\/checkout\/pro/);
  assert.match(HOME_HTML, /Start Pro — \$19\/mo/);
  assert.match(HOME_HTML, /Pro · \$19\/mo/);
  assert.doesNotMatch(HOME_HTML, /href="[^"]*workflow-sprint-intake|\/go\/sprint/i);
  assert.match(HOME_HTML, /id="workflow-sprint-intake"[^>]*data-legacy-intake-alias/);
});

test('pricing surfaces Pro self-serve as the sole paid public checkout', () => {
  assert.doesNotMatch(PRICING_HTML, /action="\/go\/diagnostic-pay"/);
  assert.doesNotMatch(PRICING_HTML, /\$499/);
  assert.doesNotMatch(PRICING_HTML, /sprint_diagnostic/);
  assert.match(PRICING_HTML, /\/checkout\/pro/);
  assert.match(PRICING_HTML, /Start Pro/i);
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
  assert.match(PRICING_HTML, /not generally available/i);
  assert.doesNotMatch(PRICING_HTML, /Hosted team lesson sync|Hosted org dashboard/i);
  assert.doesNotMatch(PRICING_HTML, /\$49\s*(?:<[^>]+>\s*)*\/seat\/mo/i);
  assert.doesNotMatch(PRICING_HTML, /shared team DB/i);
});

test('retired managed diagnostic routes alias to Pro self-serve', () => {
  const server = fs.readFileSync(path.join(ROOT, 'src', 'api', 'server.js'), 'utf8');
  const diagnosticHtml = fs.readFileSync(path.join(ROOT, 'public', 'diagnostic.html'), 'utf8');

  assert.match(diagnosticHtml, /not offered|retired|Pro/i);
  assert.doesNotMatch(diagnosticHtml, /action="\/go\/diagnostic-pay"/);
  assert.match(server, /'diagnostic-pay':/);
  assert.match(server, /path: '\/checkout\/pro'/);
  assert.doesNotMatch(server, /'diagnostic-pay':[\s\S]{0,400}requiresPost: true/);
});

test('public enforcement claims match the implemented default and strict boundaries', () => {
  const { spawnSync } = require('node:child_process');
  // Pin enforcement mode so an operator shell with THUMBGATE_STRICT_ENFORCEMENT=1
  // (common after never-spend hardening) cannot flip the default-mode assertion.
  const baseEnv = {
    ...process.env,
    THUMBGATE_STRICT_ENFORCEMENT: '',
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
  assert.equal(runGate('git push --force origin main'), 'allow');
  assert.equal(runGate('git push --force origin main', { THUMBGATE_STRICT_ENFORCEMENT: '1' }), 'deny');
  assert.match(HOME_HTML, /secret exfiltration[\s\S]*denied by default/i);
  assert.match(HOME_HTML, /Matching destructive actions warn by default and deny in strict mode/i);
});
