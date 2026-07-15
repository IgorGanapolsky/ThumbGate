'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const EXPECTED_LESSON_ID = 'mem_1784128183133_ws7jof';
const ASHBY_QUERY = "Submit an Ashby job application with custom fields (segmented Yes/No, radios, country location) by driving the user's real Chrome via CDP";
const RETRIEVAL_MODULES = [
  'scripts/cross-encoder-reranker.js',
  'scripts/lesson-embedding-index.js',
  'scripts/lesson-reranker.js',
  'scripts/lesson-retrieval.js',
];

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

test('packed npm artifact captures bare feedback and retrieves the Ashby lesson', { timeout: 120_000 }, (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-packed-feedback-retrieval-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const packDir = path.join(tempRoot, 'pack');
  const installDir = path.join(tempRoot, 'install');
  const homeDir = path.join(tempRoot, 'home');
  const feedbackDir = path.join(tempRoot, 'feedback');
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(feedbackDir, { recursive: true });

  const packResult = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', packDir], {
    cwd: ROOT,
    encoding: 'utf8',
  }));
  const tarballPath = path.join(packDir, packResult[0].filename);
  execFileSync('npm', ['install', '--prefix', installDir, '--ignore-scripts', '--no-audit', '--no-fund', tarballPath], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  const installedRoot = path.join(installDir, 'node_modules', 'thumbgate');
  assert.equal(require(path.join(installedRoot, 'package.json')).version, require('../package.json').version);
  for (const modulePath of RETRIEVAL_MODULES) {
    assert.equal(fs.existsSync(path.join(installedRoot, modulePath)), true, `${modulePath} missing after npm install`);
  }

  const hookResult = spawnSync(process.execPath, [path.join(installedRoot, 'bin', 'cli.js'), 'hook-auto-capture'], {
    cwd: tempRoot,
    env: {
      ...process.env,
      HOME: homeDir,
      THUMBGATE_FEEDBACK_DIR: feedbackDir,
      THUMBGATE_NO_NUDGE: '1',
      THUMBGATE_NO_TELEMETRY: '1',
      THUMBGATE_DISABLE_CLAUDE_HISTORY_SYNC: '1',
    },
    input: JSON.stringify({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'packed-session',
      prompt_id: 'packed-prompt',
      cwd: tempRoot,
      prompt: '👍',
    }),
    encoding: 'utf8',
  });
  assert.equal(hookResult.status, 0, hookResult.stderr);
  assert.match(hookResult.stdout, /Thumbs up recorded/);
  assert.match(hookResult.stdout, /Feedback ID: fb_/);
  assert.match(hookResult.stdout, /Reusable memory: not created/);
  const feedbackEvents = readJsonl(path.join(feedbackDir, 'feedback-log.jsonl'));
  assert.equal(feedbackEvents.length, 1);
  assert.match(feedbackEvents[0].sourceEvent.key, /^fev_[a-f0-9]{64}$/);

  const memories = [
    {
      id: EXPECTED_LESSON_ID,
      title: "SUCCESS: Drove the user's real Chrome via CDP to submit an Ashby job application",
      content: 'Use CDP for Ashby custom fields including segmented Yes/No, radio choices, and country location.',
      tags: ['positive', 'browser', 'ashby'],
      metadata: { toolsUsed: ['Browser'] },
      timestamp: new Date().toISOString(),
    },
    {
      id: 'mem_distractor_git',
      title: 'Avoid force-pushing protected branches',
      content: 'Use a normal pull request and preserve branch protection.',
      tags: ['negative', 'git'],
      metadata: { toolsUsed: ['Bash'] },
      timestamp: new Date().toISOString(),
    },
    {
      id: 'mem_distractor_docs',
      title: 'Keep README examples current',
      content: 'Update documentation examples when command flags change.',
      tags: ['positive', 'docs'],
      metadata: { toolsUsed: ['Write'] },
      timestamp: new Date().toISOString(),
    },
  ];
  fs.writeFileSync(path.join(feedbackDir, 'memory-log.jsonl'), `${memories.map((row) => JSON.stringify(row)).join('\n')}\n`);

  const { retrieveRelevantLessons } = require(path.join(installedRoot, 'scripts', 'lesson-retrieval.js'));
  const results = retrieveRelevantLessons('Browser', ASHBY_QUERY, { feedbackDir, maxResults: 5 });
  assert.ok(results.length > 0);
  assert.equal(results[0].id, EXPECTED_LESSON_ID);

  const { getExposedTools, getToolCapability } = require(path.join(installedRoot, 'adapters', 'mcp', 'server-stdio.js'));
  const exposedNames = new Set(getExposedTools('default').map((tool) => tool.name));
  assert.equal(exposedNames.has('retrieve_lessons'), true);
  assert.equal(getToolCapability('retrieve_lessons').available, true);
  assert.equal(exposedNames.has('managed_agent_status'), false);
  assert.equal(exposedNames.has('run_managed_lesson_agent'), false);
});
