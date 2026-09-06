'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  HISTORY_PATH,
  LISTING_PATH,
  assertNoIdentities,
  buildReport,
  parseArgs,
  run,
  validateHistory,
} = require('../scripts/star-history');

const ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'github-star-history.json');
const SCRIPT = path.join(ROOT, 'scripts', 'star-history.js');

test('fixture weeks validate, days sum to total, and carry no identities', () => {
  const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const weeks = validateHistory(raw);
  assert.ok(weeks.length >= 20, `expected many weeks, got ${weeks.length}`);
  assert.equal(
    weeks.reduce((sum, row) => sum + row.total, 0),
    26,
  );
  assert.doesNotThrow(() => assertNoIdentities(raw));
  assert.throws(
    () => assertNoIdentities([{ week: 1, total: 0, days: [0, 0, 0, 0, 0, 0, 0], login: 'someone' }]),
    /Identity field login/,
  );
});

test('validateHistory fail-closes on a days/total mismatch or short days array', () => {
  assert.throws(
    () => validateHistory([{ week: 1_700_000_000, total: 2, days: [1, 0, 0, 0, 0, 0, 0] }]),
    /days sum 1 !== total 2/,
  );
  assert.throws(
    () => validateHistory([{ week: 1_700_000_000, total: 0, days: [0, 0, 0] }]),
    /days must be length 7/,
  );
  assert.throws(() => validateHistory({ week: 1 }), /must be an array/);
});

test('buildReport never treats stars as revenue and flags listing unused', () => {
  const weeks = validateHistory(JSON.parse(fs.readFileSync(FIXTURE, 'utf8')));
  const report = buildReport({
    weeks,
    count: 26,
    repo: 'IgorGanapolsky/ThumbGate',
    source: 'fixture:test',
  });
  assert.equal(report.ok, true);
  assert.equal(report.listingEndpointUsed, false);
  assert.equal(report.addedStars, 26);
  assert.equal(report.currentStars, 26);
  assert.equal(report.endpoint.includes(HISTORY_PATH), true);
  assert.equal(report.endpoint.includes(`${LISTING_PATH}?`), false);
  assert.match(report.disclaimer, /not npm installs and not revenue/i);
  assert.equal(JSON.stringify(report).includes('login'), false);
});

test('CLI --fixture --json matches the parser and exits 0', () => {
  const cli = spawnSync(process.execPath, [SCRIPT, '--fixture', FIXTURE, '--json'], {
    encoding: 'utf8',
    cwd: ROOT,
  });
  assert.equal(cli.status, 0, cli.stderr);
  const report = JSON.parse(cli.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.addedStars, 26);
  assert.equal(report.listingEndpointUsed, false);
  assert.match(report.source, /github-star-history\.json/);
});

test('run() with an injected getter never hits the listing endpoint', async () => {
  const calls = [];
  const weeks = validateHistory(JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))).slice(0, 2);
  const payload = weeks.map((row) => ({ week: row.week, total: row.total, days: row.days }));
  const report = await run(['--fetch'], {
    get: async (pathname) => {
      calls.push(pathname);
      if (pathname.includes(LISTING_PATH) && !pathname.includes(HISTORY_PATH) && !pathname.includes('/stargazers/count')) {
        throw new Error(`test injected listing call: ${pathname}`);
      }
      if (pathname.includes(HISTORY_PATH)) return payload;
      if (pathname.includes('/stargazers/count')) return { count: 26 };
      throw new Error(`unexpected path ${pathname}`);
    },
  });
  assert.ok(calls.every((p) => p.includes('/history') || p.includes('/count')));
  assert.equal(report.listingEndpointUsed, false);
  assert.equal(report.addedStars, weeks.reduce((sum, row) => sum + row.total, 0));
});

test('parseArgs rejects an unsafe repo slug', () => {
  assert.throws(() => parseArgs(['--repo', '../etc/passwd']), /Invalid --repo/);
});

test('README surfaces live star and npm-download badges without hardcoded star counts', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /img\.shields\.io\/github\/stars\/IgorGanapolsky\/ThumbGate/);
  assert.match(readme, /img\.shields\.io\/npm\/dw\/thumbgate/);
  assert.match(readme, /ThumbGate is the self-improving pre-action firewall/);
  assert.match(readme, /stargazers\/history/);
  assert.doesNotMatch(readme, /\b26 stars\b/);
  assert.match(readme, /Stars are not npm installs and not revenue/);
});
