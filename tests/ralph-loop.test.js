'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const {
  RALPH_STATE_PATHS,
  buildRalphSteps,
  isCliEntrypoint,
  normalizeMode,
  parseArgs,
  renderMarkdownReport,
  runRalphLoop,
  runStep,
} = require('../scripts/ralph-loop');

test('parseArgs supports Ralph modes, dry runs, and artifact directories', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-args-'));
  const options = parseArgs([
    '--mode',
    'engage',
    '--dry-run',
    '--artifact-dir',
    tmp,
    '--timezone=UTC',
    '--date',
    '2026-04-13',
  ]);

  assert.equal(options.mode, 'engage');
  assert.equal(options.dryRun, true);
  assert.equal(options.artifactDir, tmp);
  assert.equal(options.timezone, 'UTC');
  assert.equal(options.date, '2026-04-13');

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('normalizeMode rejects unknown Ralph modes', () => {
  assert.throws(() => normalizeMode('spray-and-pray'), /Invalid Ralph mode/);
});

test('buildRalphSteps keeps hourly all mode focused on sensing, replying, and audit proof', () => {
  const steps = buildRalphSteps({ mode: 'all', dryRun: true }, {});
  const ids = steps.map((step) => step.id);

  assert.deepEqual(ids, [
    'poll-analytics',
    'sync-launch-assets',
    'reply-monitor',
    'engagement-audit',
  ]);
  assert.match(steps.find((step) => step.id === 'sync-launch-assets').skipReason, /ZERNIO_API_KEY/);
  assert.deepEqual(steps.find((step) => step.id === 'reply-monitor').args.slice(-1), ['--dry-run']);
  assert.equal(ids.includes('daily-social-post'), false);
});

test('buildRalphSteps supports manual post mode with skip evidence', () => {
  const steps = buildRalphSteps({ mode: 'post', dryRun: true }, {});
  const post = steps.find((step) => step.id === 'daily-social-post');

  assert.deepEqual(steps.map((step) => step.id), ['daily-social-post', 'engagement-audit']);
  assert.deepEqual(post.args.slice(-1), ['--dry-run']);
  assert.match(post.skipReason, /ZERNIO_API_KEY/);
});

test('runStep records skipped, external, and failed step evidence', () => {
  const skipped = runStep({
    id: 'sync-launch-assets',
    stage: 'sense',
    skipReason: 'missing env: ZERNIO_API_KEY',
  });
  assert.equal(skipped.status, 'skipped');
  assert.match(skipped.skipReason, /ZERNIO_API_KEY/);

  const passed = runStep({
    id: 'node-ok',
    stage: 'prove',
    type: 'node',
    command: process.execPath,
    args: ['-e', 'process.stdout.write("ok")'],
  });
  assert.equal(passed.status, 'passed');
  assert.equal(passed.exitCode, 0);
  assert.equal(passed.stdoutTail, 'ok');

  const failed = runStep({
    id: 'node-fail',
    stage: 'prove',
    type: 'node',
    command: process.execPath,
    args: ['-e', 'process.stderr.write("bad"); process.exit(2)'],
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.exitCode, 2);
  assert.equal(failed.stderrTail, 'bad');
});

test('renderMarkdownReport escapes table separators and CLI entrypoint detection is path based', () => {
  const markdown = renderMarkdownReport({
    generatedAt: '2026-04-13T00:00:00.000Z',
    mode: 'audit',
    dryRun: false,
    steps: [{
      id: 'reply-monitor',
      stage: 'engage',
      status: 'skipped',
      skipReason: 'missing A|B',
    }],
    audit: {
      totals: {
        checked: 1,
        replied: 0,
        drafted: 1,
        skipped: 0,
      },
    },
  });

  assert.match(markdown, /missing A\/B/);
  assert.equal(isCliEntrypoint(['node', path.join(PROJECT_ROOT, 'scripts', 'ralph-loop.js')]), true);
  assert.equal(isCliEntrypoint(['node', path.join(PROJECT_ROOT, 'tests', 'ralph-loop.test.js')]), false);
});

test('runRalphLoop writes machine-readable evidence and keeps state paths explicit', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-loop-'));
  const calls = [];
  const report = runRalphLoop({
    mode: 'engage',
    dryRun: true,
    artifactDir: tmp,
    replyStatePath: path.join(tmp, 'reply-monitor-state.json'),
    draftsPath: path.join(tmp, 'reply-drafts.jsonl'),
    launchAssetsPath: path.join(tmp, 'social-launch-assets.json'),
  }, {
    env: { ZERNIO_API_KEY: 'zernio_test_key' },
    runner: (step) => {
      calls.push(step.id);
      return {
        exitCode: 0,
        stdout: `${step.id} ok\n`,
        stderr: '',
      };
    },
  });

  assert.deepEqual(calls, ['sync-launch-assets', 'reply-monitor']);
  assert.equal(report.mode, 'engage');
  assert.equal(report.dryRun, true);
  assert.deepEqual(report.statePaths, RALPH_STATE_PATHS);
  assert.equal(fs.existsSync(path.join(tmp, 'ralph-loop-report.json')), true);
  assert.equal(fs.existsSync(path.join(tmp, 'ralph-loop-report.md')), true);

  const rendered = fs.readFileSync(path.join(tmp, 'ralph-loop-report.md'), 'utf8');
  assert.match(rendered, /Reliability Gateway/);
  assert.match(rendered, /VERIFICATION_EVIDENCE\.md/);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('Ralph workflows are scheduled, stateful, and split outbound from reply engagement', () => {
  const workflowsDir = path.join(PROJECT_ROOT, '.github', 'workflows');
  const ralph = fs.readFileSync(path.join(workflowsDir, 'ralph-loop.yml'), 'utf8');
  const ralphMode = fs.readFileSync(path.join(workflowsDir, 'ralph-mode.yml'), 'utf8');
  const replyMonitor = fs.readFileSync(path.join(workflowsDir, 'reply-monitor.yml'), 'utf8');
  const socialEngagement = fs.readFileSync(path.join(workflowsDir, 'social-engagement-hourly.yml'), 'utf8');

  assert.match(ralph, /name: Ralph Loop Audience Engagement/);
  assert.match(ralph, /cron: '17 \* \* \* \*'/);
  assert.match(ralph, /actions\/cache\/restore@v4/);
  assert.match(ralph, /actions\/cache\/save@v4/);
  assert.match(ralph, /node scripts\/ralph-loop\.js --mode="\$MODE"/);
  assert.match(ralph, /\.thumbgate\/reply-monitor-state\.json/);
  assert.match(ralph, /\.thumbgate\/reply-drafts\.jsonl/);
  assert.match(ralph, /\.thumbgate\/social-launch-assets\.json/);
  assert.match(ralphMode, /name: Ralph Mode - 24\/7 Engagement Loop/);
  assert.match(ralphMode, /cron: '0 \*\/2 \* \* \*'/);
  assert.match(ralphMode, /actions\/cache\/restore@v4/);
  assert.match(ralphMode, /actions\/cache\/save@v4/);
  assert.match(ralphMode, /\.thumbgate\/ralph-state\.json/);
  assert.match(ralphMode, /node scripts\/ralph-mode-ci\.js/);
  assert.doesNotMatch(replyMonitor, /^\s*schedule:/m);
  assert.doesNotMatch(socialEngagement, /0 9,13,17,21 \* \* \*/);
});
