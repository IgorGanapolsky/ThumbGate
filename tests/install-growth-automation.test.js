'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  buildNodeEvalCommand,
  buildGrowthSchedules,
  installGrowthAutomation,
} = require('../scripts/social-analytics/install-growth-automation');

test('buildNodeEvalCommand pins the repo root and script path', () => {
  const command = buildNodeEvalCommand('/tmp/example-script.js', ['--days=7']);
  assert.match(command, /spawnSync/);
  assert.match(command, /process\.chdir/);
  assert.match(command, /example-script\.js/);
  assert.match(command, /--days=7/);
});

test('buildNodeEvalCommand executes the target CLI script instead of only requiring it', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-growth-cmd-'));
  const outPath = path.join(tmpDir, 'ran.txt');
  const scriptPath = path.join(tmpDir, 'write-file.js');
  fs.writeFileSync(scriptPath, [
    '\'use strict\';',
    'const fs = require(\'node:fs\');',
    'if (require.main === module) {',
    '  fs.writeFileSync(process.argv[2], \'executed\\n\', \'utf8\');',
    '}',
    '',
  ].join('\n'));

  const command = buildNodeEvalCommand(scriptPath, [outPath]);
  execFileSync(process.execPath, ['-e', command], { stdio: 'pipe' });

  assert.equal(fs.readFileSync(outPath, 'utf8'), 'executed\n');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('buildGrowthSchedules includes revenue, reply, and money-watch automation', () => {
  const schedules = buildGrowthSchedules();
  const ids = schedules.map((entry) => entry.id);
  assert.deepEqual(ids, [
    'thumbgate-growth-schedule-campaign',
    'thumbgate-growth-poll-zernio',
    'thumbgate-growth-sync-launch-assets',
    'thumbgate-growth-reply-monitor',
    'thumbgate-growth-money-watch',
    'thumbgate-growth-revenue-loop',
    'thumbgate-growth-social-digest',
  ]);
  const byId = Object.fromEntries(schedules.map((entry) => [entry.id, entry]));
  assert.match(byId['thumbgate-growth-revenue-loop'].command, /autonomous-sales-agent\.js/);
  assert.match(byId['thumbgate-growth-revenue-loop'].command, /gtm-revenue-loop/);
  assert.match(byId['thumbgate-growth-money-watch'].command, /money-watcher\.js/);
  assert.match(byId['thumbgate-growth-sync-launch-assets'].command, /sync-launch-assets\.js/);
});

test('installGrowthAutomation registers seven recurring jobs', () => {
  const scheduleManager = require('../scripts/schedule-manager');
  const originalCreate = scheduleManager.createSchedule;
  const originalList = scheduleManager.listSchedules;
  const calls = [];

  scheduleManager.createSchedule = (params) => {
    calls.push(params);
    return { success: true, schedule: params };
  };
  scheduleManager.listSchedules = () => calls;

  const result = installGrowthAutomation();

  scheduleManager.createSchedule = originalCreate;
  scheduleManager.listSchedules = originalList;

  assert.equal(result.installed.length, 7);
  assert.equal(calls.length, 7);
  assert.equal(calls[0].id, 'thumbgate-growth-schedule-campaign');
  assert.equal(calls[1].id, 'thumbgate-growth-poll-zernio');
  assert.equal(calls[2].id, 'thumbgate-growth-sync-launch-assets');
  assert.equal(calls[3].id, 'thumbgate-growth-reply-monitor');
  assert.equal(calls[4].id, 'thumbgate-growth-money-watch');
  assert.equal(calls[5].id, 'thumbgate-growth-revenue-loop');
  assert.equal(calls[6].id, 'thumbgate-growth-social-digest');
});
