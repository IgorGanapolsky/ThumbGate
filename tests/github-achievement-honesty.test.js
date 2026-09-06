'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  REFUSE_FARM,
  STARSTRUCK_NEXT_TIER,
  parseAchievementSlugs,
  parseArgs,
  run,
} = require('../scripts/github-achievement-honesty');

const ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'github-achievements.json');
const SCRIPT = path.join(ROOT, 'scripts', 'github-achievement-honesty.js');

test('fixture profile HTML yields public badges and no galaxy-brain', () => {
  const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const slugs = parseAchievementSlugs(raw.profileHtml);
  assert.ok(slugs.includes('pull-shark'));
  assert.ok(slugs.includes('pair-extraordinaire'));
  assert.equal(slugs.includes('galaxy-brain'), false);
});

test('refuseFarm blocks YOLO-on-main, Quickdraw theater, fake coauthors, and farm CLIs', () => {
  assert.ok(REFUSE_FARM.includes('yolo-merge-protected-main'));
  assert.ok(REFUSE_FARM.includes('quickdraw-close-own-issue-in-5min'));
  assert.ok(REFUSE_FARM.includes('fake-coauthored-by'));
  assert.ok(REFUSE_FARM.includes('achievement-farm-cli'));
  assert.equal(STARSTRUCK_NEXT_TIER, 128);
});

test('CLI --fixture --json never recommends a farm CLI and exits 0', () => {
  const cli = spawnSync(process.execPath, [SCRIPT, '--fixture', FIXTURE, '--json'], {
    encoding: 'utf8',
    cwd: ROOT,
  });
  assert.equal(cli.status, 0, cli.stderr);
  const report = JSON.parse(cli.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.farmCliUsed, false);
  assert.equal(report.yoloAllowedOnThumbGateMain, false);
  assert.ok(report.missingObtainable.includes('galaxy-brain'));
  assert.equal(report.missingObtainable.includes('arctic-code-vault-contributor'), false);
  assert.ok(report.earned.includes('arctic-code-vault-contributor'));
  assert.match(report.disclaimer, /not npm installs and not revenue/i);
  assert.doesNotMatch(JSON.stringify(report), /GitHub-Achievement-CLI/);
});

test('run() injected getter parses live-shaped HTML without farming', async () => {
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  let report;
  try {
    report = await run(['--fetch', '--json'], {
      getHtml: async () =>
        '<a href="/u?achievement=pull-shark&tab=achievements">x</a><a href="/u?achievement=starstruck">y</a>',
    });
  } finally {
    process.stdout.write = origWrite;
  }
  assert.ok(report.earned.includes('pull-shark'));
  assert.equal(report.farmCliUsed, false);
  assert.equal(report.qnaCategoryPresent, null);
  assert.equal(report.acceptedDiscussionAnswers, null);
});

test('parseArgs rejects an unsafe user', () => {
  assert.throws(() => parseArgs(['--user', '../etc/passwd']), /Invalid --user/);
});

test('README and issue config do not teach badge farming', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /do not farm GitHub profile badges/i);
  assert.doesNotMatch(readme, /close an issue within 5 min/i);
  const issueConfig = fs.readFileSync(
    path.join(ROOT, '.github', 'ISSUE_TEMPLATE', 'config.yml'),
    'utf8',
  );
  assert.match(issueConfig, /discussions\/categories\/q-a/);
});
