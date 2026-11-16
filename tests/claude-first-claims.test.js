'use strict';

// Every claim on the Claude-first homepage and pricing page is pinned to the code or to a recorded run.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const pricing = fs.readFileSync(path.join(ROOT, 'public', 'pricing.html'), 'utf8');

test('recorded hero decisions match what gate-check returns in strict mode', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-claims-'));
  spawnSync('git', ['init', '-q', home]);
  const cases = [
    ['git ' + 'push --force origin main', 'GATE:force-push', 'Force push blocked. This is destructive and irreversible.'],
    ['git reset --hard HEAD~5', 'GATE:git-reset-hard', 'git reset --hard is blocked because it can destroy uncommitted work.'],
    ['rm -rf ~/', 'GATE:rm-rf-home-or-root', 'Broad rm -rf against root or home is blocked.'],
  ];
  for (const [command, gate, sentence] of cases) {
    const run = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'cli.js'), 'gate-check'], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, hook_event_name: 'PreToolUse', cwd: home }),
      encoding: 'utf8',
      cwd: home,
      env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, THUMBGATE_NO_TELEMETRY: '1', THUMBGATE_STRICT_ENFORCEMENT: '1' },
      timeout: 120000,
    });
    assert.ok(run.stdout, `${command}: no stdout; status=${run.status} signal=${run.signal} stderr=${run.stderr}`);
    const out = JSON.parse(run.stdout).hookSpecificOutput;
    assert.equal(run.status, 0, `${command}: the deny is carried in JSON with exit 0, as the page shows`);
    assert.equal(out.permissionDecision, 'deny', command);
    assert.ok(out.permissionDecisionReason.includes(`[${gate}]`), `${command}: ${out.permissionDecisionReason}`);
    assert.ok(out.permissionDecisionReason.includes(sentence), command);
    assert.ok(index.includes(`[${gate}]`), `homepage shows ${gate}`);
    assert.ok(index.includes(sentence.slice(0, 40)), `homepage shows the reason for ${gate}`);
  }
  fs.rmSync(home, { recursive: true, force: true });
});

test('the hero does not claim rm -rf on a project folder is denied', () => {
  const hero = index.slice(index.indexOf('<!-- HERO -->'), index.indexOf('id="loop"'));
  assert.doesNotMatch(hero, /rm -rf \.\/|prod-db/);
});

test('pricing Free vs Pro rows match the limits in the code', () => {
  const rateLimiter = require('../scripts/rate-limiter');
  const { FREE_TIER_MAX_GATES, FREE_TIER_LIMITS } = rateLimiter;
  const table = pricing.slice(pricing.indexOf('id="free-vs-pro"'));
  assert.equal(FREE_TIER_MAX_GATES, 3);
  assert.match(table, new RegExp(`Learned rules[^<]*</th><td>${FREE_TIER_MAX_GATES}</td><td>All</td>`));
  // No daily block quota exists in the code, so neither plan may promise or imply one.
  assert.equal('FREE_TIER_DAILY_BLOCKS' in rateLimiter, false);
  assert.match(table, /Gate blocks per day \(strict mode\)<\/th><td>Unlimited<\/td><td>Unlimited<\/td>/);
  assert.doesNotMatch(table, /then warn|daily cap/i);
  assert.doesNotMatch(index, /then warns|daily cap/i);
  assert.equal(FREE_TIER_LIMITS.recall.lifetime, 0);
  assert.equal(FREE_TIER_LIMITS.search_lessons.lifetime, 0);
  assert.match(table, /Recall of past lessons<\/th><td>No<\/td><td>Yes/);
  assert.match(table, /Lesson search<\/th><td>No<\/td><td>Yes/);
  for (const row of ['Team-shared rules', 'Lessons synced across machines', 'Audit history for managers']) {
    assert.match(table, new RegExp(`${row}</th><td>Coming</td><td>Coming</td>`), `${row} is marked coming, not sold`);
  }
});

test('catastrophic gates are hard floors in the engine, as the pricing table says', () => {
  const engine = fs.readFileSync(path.join(ROOT, 'scripts', 'gates-engine.js'), 'utf8');
  for (const id of ['force-push', 'git-reset-hard', 'git-clean-force', 'rm-rf-home-or-root']) {
    assert.match(engine.slice(engine.indexOf('CATASTROPHIC_DECLARATIVE_GATE_IDS')), new RegExp(`['"]${id}['"]`), id);
  }
});

test('adoption numbers are fetched live, never typed into the page', () => {
  assert.match(index, /<p class="hero-note" id="adoption-line" hidden><\/p>/);
  assert.match(index, /api\.github\.com\/repos\/IgorGanapolsky\/ThumbGate/);
  assert.match(index, /api\.npmjs\.org\/downloads\/point\/last-week\/thumbgate/);
  assert.doesNotMatch(index, /\d[\d,]* (GitHub )?stars/i);
});

test('the top nav carries no SSO provider badge', () => {
  assert.doesNotMatch(index, /toUpperCase\(\) \+ ' SSO'/);
});
