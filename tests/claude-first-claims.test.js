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

test('recorded hero transcript matches what the hooks do on a default install', () => {
  // The hero shows docs/demo/thumbs-down-hold/transcript-1.45.1.txt: one typed thumbs-down holds the command, "go ahead"
  // releases it, a second thumbs-down makes it a deny, and terraform destroy is denied. No strict mode.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-claims-'));
  const project = path.join(home, 'my-app');
  fs.mkdirSync(project);
  spawnSync('git', ['init', '-q', project]);
  const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, THUMBGATE_NO_TELEMETRY: '1', THUMBGATE_NO_AUTO_UPDATE: '1', THUMBGATE_FEEDBACK_DIR: path.join(home, 'fb') };
  const cli = (sub, payload) => spawnSync(process.execPath, [path.join(ROOT, 'bin', 'cli.js'), sub], { input: JSON.stringify(payload), encoding: 'utf8', cwd: project, env, timeout: 120000 });
  const gate = (command) => {
    const run = cli('gate-check', { tool_name: 'Bash', tool_input: { command }, cwd: project, session_id: 's1' });
    assert.equal(run.status, 0, `${command}: the decision is carried in JSON with exit 0, as the page shows`);
    const last = String(run.stdout || '').trim().split('\n').filter(Boolean).pop() || '{}';
    const out = JSON.parse(last).hookSpecificOutput || {};
    return { decision: out.permissionDecision || 'allow', reason: out.permissionDecisionReason || '' };
  };
  const say = (prompt) => cli('hook-auto-capture', { prompt, session_id: 's1', cwd: project });
  const migrate = 'node scripts/migrate.js --env prod';

  assert.equal(gate(migrate).decision, 'allow');
  say('thumbs down, wrong database, that was prod');
  const held = gate(`${migrate} --force`);
  assert.equal(held.decision, 'deny', 'the retry right after the thumbs-down is held');
  assert.match(held.reason, /\[GATE:thumbs-down-hold\] The person gave a thumbs-down right after `node scripts\/migrate\.js --env …`/);
  assert.notEqual(gate('git status').decision, 'deny', 'other commands are not held');
  say('go ahead');
  assert.notEqual(gate(migrate).decision, 'deny', 'released by the person; it only warns now');
  say('thumbs down, never run migrations against prod');
  say('go ahead');
  const learned = gate(migrate);
  assert.equal(learned.decision, 'deny', 'a second typed thumbs-down makes it a deny, no strict mode');
  assert.match(learned.reason, /\[GATE:auto-node-scripts-migrate-js-env-prod-[0-9a-f]+\] Auto-promoted repeated executable action/);

  const hero = index.slice(index.indexOf('<!-- HERO -->'), index.indexOf('id="loop"'));
  assert.ok(hero.includes('[GATE:thumbs-down-hold] The person gave a thumbs-down right after `node scripts/migrate.js --env …`'), 'hero shows the hold reason');
  assert.ok(hero.includes('[GATE:auto-node-scripts-migrate-js-env-prod-'), 'hero shows the learned deny');
  assert.ok(hero.includes('(2 occurrences in 30 days)'));
  for (const command of ['terraform destroy', 'kubectl delete namespace prod', 'aws s3 rm s3://prod-backups --recursive', 'git ' + 'push --force origin main', 'git reset --hard HEAD~5', 'rm -rf ~/']) {
    assert.equal(gate(command).decision, 'deny', `${command} is denied on a default install, as the hero says`);
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
