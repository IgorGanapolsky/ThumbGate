'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { cacheUpdateHookCommand, statuslineCommand } = require('../scripts/hook-runtime');
const { activateLicense } = require('../scripts/license');
const { writeActiveProjectState } = require('../scripts/feedback-paths');
const { createLesson } = require('../scripts/lesson-inference');

const STATUSLINE_PATH = path.join(__dirname, '..', 'scripts', 'statusline.sh');
const CACHE_UPDATER_PATH = path.join(__dirname, '..', 'scripts', 'hook-thumbgate-cache-updater.js');
const AUTO_CAPTURE_HOOK_PATH = path.join(__dirname, '..', 'scripts', 'hook-auto-capture.sh');
const LOCAL_STATS_PATH = path.join(__dirname, '..', 'scripts', 'statusline-local-stats.js');
const PKG_VERSION = require('../package.json').version;
const SAFE_SYSTEM_PATH = Array.from(new Set([
  path.dirname(process.execPath),
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
])).join(path.delimiter);

function linkFixture(overrides = {}) {
  return {
    state: 'ready',
    dashboardLabel: 'Dashboard',
    lessonsLabel: 'Lessons',
    dashboardUrl: 'http://localhost:3456/dashboard',
    lessonsUrl: 'http://localhost:3456/lessons',
    upUrl: 'http://localhost:3456/feedback/quick?signal=up',
    downUrl: 'http://localhost:3456/feedback/quick?signal=down',
    ...overrides,
  };
}

function runStatusline(cachePayload, extraEnv = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-statusline-render-'));
  const cachePath = path.join(tmpDir, 'statusline_cache.json');
  const homeDir = path.join(tmpDir, 'home');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.writeFileSync(
    cachePath,
    JSON.stringify({
      updated_at: String(Math.floor(Date.now() / 1000)),
      ...cachePayload,
    })
  );

  try {
    return execFileSync('bash', [STATUSLINE_PATH], {
      encoding: 'utf8',
      input: JSON.stringify({ context_window: { used_percentage: 25 } }),
      env: {
        ...process.env,
        HOME: homeDir,
        THUMBGATE_FEEDBACK_DIR: tmpDir,
        ...extraEnv,
      },
      timeout: 5000,
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function stripStatuslineFormatting(text) {
  return String(text)
    .replace(/\u001b]8;;[^\u0007]*\u0007/g, '')
    .replace(/\u001b]8;;\u0007/g, '')
    .replace(/\u001b\[[0-9;]*m/g, '');
}

test('statusline script exists and is executable', () => {
  assert.ok(fs.existsSync(STATUSLINE_PATH), 'scripts/statusline.sh must exist');
  const stat = fs.statSync(STATUSLINE_PATH);
  assert.ok(stat.mode & 0o111, 'scripts/statusline.sh must be executable');
});

test('statusline script reads jq input and outputs ThumbGate line', () => {
  const out = runStatusline({
    thumbs_up: '10', thumbs_down: '5', lessons: '3', trend: 'improving'
  }, {
    _TEST_THUMBGATE_STATUSLINE_LINKS_JSON: JSON.stringify(linkFixture()),
  });
  assert.ok(out.includes(`ThumbGate v${PKG_VERSION}`), 'should show package version');
  assert.ok(out.includes('Free'), 'should show license tier');
  assert.ok(out.includes('10'), 'should show thumbs up count');
  assert.ok(out.includes('5'), 'should show thumbs down count');
  assert.ok(out.includes('3'), 'should show lesson count');
  assert.match(out, /Dashboard/);
  assert.match(out, /Lessons/);
  assert.doesNotMatch(out, /Dashboard \(http:\/\/localhost:3456\/dashboard\)/);
  assert.doesNotMatch(out, /Lessons \(http:\/\/localhost:3456\/lessons\)/);
});

test('statusline shows "no feedback yet" when cache has zeros', () => {
  const out = runStatusline({
    thumbs_up: '0', thumbs_down: '0', lessons: '0', trend: '?'
  }, {
    _TEST_THUMBGATE_STATUSLINE_LINKS_JSON: JSON.stringify(linkFixture({
      state: 'offline',
      dashboardLabel: 'Dash: thumbgate pro',
      lessonsLabel: 'Learn: thumbgate lessons',
      dashboardUrl: '',
      lessonsUrl: '',
      upUrl: '',
      downUrl: '',
    })),
  });
  assert.ok(out.includes(`ThumbGate v${PKG_VERSION}`), 'should show package version');
  assert.ok(out.includes('no feedback yet'), 'should show no-data message');
  assert.match(out, /Dash: thumbgate pro/);
  assert.match(out, /Learn: thumbgate lessons/);
});

test('statusline rebuilds counters from local feedback logs when cache is empty', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-statusline-local-'));
  const homeDir = path.join(tmpDir, 'home');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, 'feedback-log.jsonl'),
    [
      JSON.stringify({ signal: 'positive', timestamp: '2026-04-08T10:00:00.000Z', context: 'verified fix' }),
      JSON.stringify({ signal: 'negative', timestamp: '2026-04-08T10:01:00.000Z', context: 'unverified claim' }),
      JSON.stringify({ signal: 'negative', timestamp: '2026-04-08T10:02:00.000Z', context: 'scope creep' }),
    ].join('\n') + '\n'
  );
  fs.writeFileSync(
    path.join(tmpDir, 'statusline_cache.json'),
    JSON.stringify({ thumbs_up: '0', thumbs_down: '0', lessons: '0', trend: '?', updated_at: '0' })
  );

  try {
    const out = execFileSync('bash', [STATUSLINE_PATH], {
      encoding: 'utf8',
      input: JSON.stringify({ context_window: { used_percentage: 5 } }),
      env: {
        ...process.env,
        HOME: homeDir,
        THUMBGATE_FEEDBACK_DIR: tmpDir,
      },
      timeout: 5000,
    });
    assert.ok(out.includes('1'), 'should show reconstructed positive count');
    assert.ok(out.includes('2'), 'should show reconstructed negative count');

    const cache = JSON.parse(fs.readFileSync(path.join(tmpDir, 'statusline_cache.json'), 'utf8'));
    assert.equal(cache.thumbs_up, '1');
    assert.equal(cache.thumbs_down, '2');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('statusline rebuilds counters from Claude history when the prompt hook missed feedback', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-statusline-claude-history-'));
  const projectDir = path.join(tmpDir, 'project');
  const feedbackDir = path.join(projectDir, '.thumbgate');
  const homeDir = path.join(tmpDir, 'home');
  const historyPath = path.join(homeDir, '.claude', 'history.jsonl');
  fs.mkdirSync(feedbackDir, { recursive: true });
  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  fs.writeFileSync(
    historyPath,
    `${JSON.stringify({
      display: 'thumbs down',
      timestamp: 1775750156301,
      project: projectDir,
      sessionId: 'session-1',
    })}\n`
  );
  fs.writeFileSync(
    path.join(feedbackDir, 'statusline_cache.json'),
    JSON.stringify({ thumbs_up: '0', thumbs_down: '0', lessons: '0', trend: '?', updated_at: '0' })
  );

  try {
    const out = execFileSync('bash', [STATUSLINE_PATH], {
      encoding: 'utf8',
      input: JSON.stringify({ context_window: { used_percentage: 5 } }),
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        THUMBGATE_FEEDBACK_DIR: feedbackDir,
        THUMBGATE_PROJECT_DIR: projectDir,
        THUMBGATE_CLAUDE_HISTORY_PATH: historyPath,
      },
      timeout: 5000,
    });
    assert.ok(out.includes('1'), 'should show the synced negative count');

    const cache = JSON.parse(fs.readFileSync(path.join(feedbackDir, 'statusline_cache.json'), 'utf8'));
    assert.equal(cache.thumbs_down, '1');
    assert.ok(fs.existsSync(path.join(feedbackDir, 'feedback-log.jsonl')), 'feedback log should be created from Claude history');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('statusline follows the persisted active project when Claude is running from a transient cwd', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-statusline-project-'));
  const homeDir = path.join(tmpDir, 'home');
  const projectDir = path.join(tmpDir, 'project-alpha');
  const transientDir = path.join(tmpDir, '.npm', '_npx', 'thumbgate-published-cli-12345');
  const feedbackDir = path.join(projectDir, '.thumbgate');
  const cachePath = path.join(feedbackDir, 'statusline_cache.json');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(feedbackDir, { recursive: true });
  fs.mkdirSync(transientDir, { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify({
    thumbs_up: '7',
    thumbs_down: '3',
    lessons: '2',
    trend: 'stable',
    updated_at: String(Math.floor(Date.now() / 1000)),
  }));
  writeActiveProjectState(projectDir, {
    home: homeDir,
    env: { ...process.env, HOME: homeDir },
  });

  try {
    const out = execFileSync('bash', [STATUSLINE_PATH], {
      cwd: transientDir,
      encoding: 'utf8',
      input: JSON.stringify({ context_window: { used_percentage: 12 } }),
      env: {
        ...process.env,
        HOME: homeDir,
        PATH: SAFE_SYSTEM_PATH,
        PWD: transientDir,
      },
      timeout: 5000,
    });
    assert.ok(out.includes('7'), 'should show the active project thumbs up count');
    assert.ok(out.includes('3'), 'should show the active project thumbs down count');
    assert.ok(out.includes(`ThumbGate v${PKG_VERSION}`), 'should show package version');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('statusline resolves project feedback from Claude cwd instead of the runtime cwd', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-statusline-claude-cwd-'));
  const homeDir = path.join(tmpDir, 'home');
  const projectDir = path.join(tmpDir, 'project-bravo');
  const runtimeDir = path.join(homeDir, '.thumbgate', 'runtime');
  const feedbackDir = path.join(projectDir, '.claude', 'memory', 'feedback');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(feedbackDir, { recursive: true });
  fs.writeFileSync(
    path.join(feedbackDir, 'feedback-log.jsonl'),
    [
      JSON.stringify({ signal: 'positive', timestamp: '2026-04-09T18:00:00.000Z', context: 'kept scope tight' }),
      JSON.stringify({ signal: 'positive', timestamp: '2026-04-09T18:01:00.000Z', context: 'verified clean worktree' }),
      JSON.stringify({ signal: 'negative', timestamp: '2026-04-09T18:02:00.000Z', context: 'stale runtime cwd' }),
    ].join('\n') + '\n'
  );

  try {
    const out = execFileSync('bash', [STATUSLINE_PATH], {
      cwd: runtimeDir,
      encoding: 'utf8',
      input: JSON.stringify({
        cwd: projectDir,
        context_window: { used_percentage: 33 },
      }),
      env: {
        ...process.env,
        HOME: homeDir,
        PATH: SAFE_SYSTEM_PATH,
        PWD: runtimeDir,
      },
      timeout: 5000,
    });

    assert.ok(out.includes('2'), 'should show project thumbs up count from Claude cwd');
    assert.ok(out.includes('1'), 'should show project thumbs down count from Claude cwd');

    const cache = JSON.parse(fs.readFileSync(path.join(feedbackDir, 'statusline_cache.json'), 'utf8'));
    assert.equal(cache.thumbs_up, '2');
    assert.equal(cache.thumbs_down, '1');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('statusline shows Pro when a valid ThumbGate license is present', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-statusline-license-'));
  const homeDir = path.join(tmpDir, 'home');
  fs.mkdirSync(homeDir, { recursive: true });
  activateLicense('tg_pro_1234567890abcdef12345678', { homeDir });
  const cachePath = path.join(tmpDir, 'statusline_cache.json');
  fs.writeFileSync(cachePath, JSON.stringify({
    thumbs_up: '2', thumbs_down: '1', lessons: '0', trend: 'stable'
  }));

  try {
    const out = execFileSync('bash', [STATUSLINE_PATH], {
      encoding: 'utf8',
      input: JSON.stringify({ context_window: { used_percentage: 5 } }),
      env: {
        ...process.env,
        HOME: homeDir,
        THUMBGATE_FEEDBACK_DIR: tmpDir,
      },
      timeout: 5000,
    });
    assert.ok(out.includes('Pro'), 'should show Pro tier when a license is active');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('statusline shows booting labels while the local dashboard is coming online', () => {
  const out = runStatusline({
    thumbs_up: '4', thumbs_down: '1', lessons: '2', trend: 'stable'
  }, {
    _TEST_THUMBGATE_STATUSLINE_LINKS_JSON: JSON.stringify(linkFixture({
      state: 'booting',
      dashboardLabel: 'Dashboard…',
      lessonsLabel: 'Lessons…',
      dashboardUrl: '',
      lessonsUrl: '',
      upUrl: '',
      downUrl: '',
    })),
  });
  assert.match(out, /Dashboard…/);
  assert.match(out, /Lessons…/);
  assert.doesNotMatch(out, /\u001b]8;;http:\/\/localhost:3456\/dashboard/);
});

test('statusline preserves dashboard links under a tight width budget', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-statusline-budget-'));
  const homeDir = path.join(tmpDir, 'home');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, 'statusline_cache.json'),
    JSON.stringify({
      thumbs_up: '157',
      thumbs_down: '1450',
      lessons: '27',
      trend: 'stable',
      updated_at: String(Math.floor(Date.now() / 1000)),
    })
  );

  const previousFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  createLesson({
    signal: 'negative',
    inferredLesson: 'MISTAKE: Something broke again because the deploy health check was skipped after merge.',
  });

  try {
    const out = execFileSync('bash', [STATUSLINE_PATH], {
      encoding: 'utf8',
      input: JSON.stringify({ context_window: { used_percentage: 25 } }),
      env: {
        ...process.env,
        HOME: homeDir,
        THUMBGATE_FEEDBACK_DIR: tmpDir,
        THUMBGATE_STATUSLINE_MAX_CHARS: '72',
        _TEST_THUMBGATE_STATUSLINE_LINKS_JSON: JSON.stringify(linkFixture()),
      },
      timeout: 5000,
    });
    const plain = stripStatuslineFormatting(out).trim();
    assert.match(plain, /Dashboard/, 'should preserve the dashboard link label');
    assert.match(plain, /Lessons/, 'should preserve the lessons link label');
    assert.match(plain, /Latest mistake \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}:/, 'should clarify that the snippet is the latest mistake');
    // localhost links are intentionally stripped from statusbar display — only real URLs shown
    assert.doesNotMatch(plain, /http:\/\/localhost/, 'should NOT include localhost links in statusbar');
  } finally {
    if (previousFeedbackDir === undefined) {
      delete process.env.THUMBGATE_FEEDBACK_DIR;
    } else {
      process.env.THUMBGATE_FEEDBACK_DIR = previousFeedbackDir;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('cache updater hook script exists', () => {
  assert.ok(fs.existsSync(CACHE_UPDATER_PATH), 'scripts/hook-thumbgate-cache-updater.js must exist');
  assert.ok(fs.existsSync(LOCAL_STATS_PATH), 'scripts/statusline-local-stats.js must exist');
});

test('user prompt hook records recent conversation history for statusline distillation', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-statusline-hook-'));
  const conversationPath = path.join(tmpDir, 'conversation-window.jsonl');

  execFileSync('bash', [AUTO_CAPTURE_HOOK_PATH], {
    encoding: 'utf8',
    env: {
      ...process.env,
      THUMBGATE_FEEDBACK_DIR: tmpDir,
      CLAUDE_USER_PROMPT: 'Need proof before saying deployed',
    },
    timeout: 5000,
  });

  assert.ok(fs.existsSync(conversationPath), 'conversation-window.jsonl should be created');
  const entries = fs.readFileSync(conversationPath, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].text, 'Need proof before saying deployed');
  assert.equal(entries[0].source, 'claude_user_prompt');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('cache updater writes cache from feedback_stats input', () => {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'thumbgate-test-'));
  const tmpCache = path.join(tmpDir, 'statusline_cache.json');

  const event = {
    tool_name: 'mcp__thumbgate__feedback_stats',
    tool_response: JSON.stringify({
      total: 100, totalPositive: 20, totalNegative: 80,
      approvalRate: 0.2, trend: 'stable',
      rubric: { samples: 42 }
    })
  };

  execFileSync(process.execPath, [CACHE_UPDATER_PATH], {
    encoding: 'utf8',
    input: JSON.stringify(event),
    env: { ...process.env, THUMBGATE_FEEDBACK_DIR: tmpDir },
    timeout: 5000
  });

  assert.ok(fs.existsSync(tmpCache), 'cache file should be created');
  const cache = JSON.parse(fs.readFileSync(tmpCache, 'utf8'));
  assert.strictEqual(cache.thumbs_up, '20');
  assert.strictEqual(cache.thumbs_down, '80');
  assert.strictEqual(cache.lessons, '42');
  assert.strictEqual(cache.trend, 'stable');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('setupClaude uses portable ThumbGate commands for status line and cache updates', () => {
  const cliSource = fs.readFileSync(path.join(__dirname, '..', 'bin', 'cli.js'), 'utf8');
  assert.ok(cliSource.includes('statusLine'), 'cli.js must wire statusLine');
  assert.ok(cliSource.includes('cacheUpdateHookCommand'), 'cli.js must wire the portable cache updater command');
  assert.ok(cliSource.includes('statuslineCommand'), 'cli.js must wire the portable statusline command');
  const cacheCommand = cacheUpdateHookCommand();
  const statusCommand = statuslineCommand();
  assert.ok(
    (cacheCommand.includes('--package') && cacheCommand.includes('thumbgate@') && cacheCommand.includes('thumbgate') && cacheCommand.includes('cache-update'))
      || cacheCommand.includes('bin/cli.js" cache-update'),
    `unexpected cache update command: ${cacheCommand}`
  );
  assert.ok(
    (statusCommand.includes('--package') && statusCommand.includes('thumbgate@') && statusCommand.includes('thumbgate') && statusCommand.includes('statusline-render'))
      || statusCommand.includes('bin/cli.js" statusline-render'),
    `unexpected statusline command: ${statusCommand}`
  );
});

test('statusline shell keeps dashboard labels compact and leaves deep links to lesson chips', () => {
  const shellSource = fs.readFileSync(STATUSLINE_PATH, 'utf8');
  assert.match(shellSource, /statusline-links\.js/);
  assert.match(shellSource, /inline_link/);
  assert.match(shellSource, /LOCAL_API_ORIGIN/);
  assert.match(shellSource, /DASHBOARD_LINK="\$DASHBOARD_LABEL"/);
  assert.match(shellSource, /LESSONS_LINK="\$LESSONS_LABEL"/);
  assert.match(shellSource, /LATEST_LESSON_LINK="\$\(inline_link/);
});

test('statusline output ends with Dashboard and Lessons links (regression guard)', () => {
  const shellSource = fs.readFileSync(STATUSLINE_PATH, 'utf8');
  // Both branches (no-feedback and has-feedback) must retain Dashboard + Lessons links
  const outputLines = shellSource.split('\n').filter(l => l.includes('DASHBOARD_LINK') && l.includes('LESSONS_LINK'));
  assert.ok(outputLines.length >= 2, `Expected at least 2 output lines with Dashboard+Lessons links, got ${outputLines.length}`);
  const lineAssembly = shellSource.split('\n').filter(l => l.includes('LATEST_LESSON_LINK') && l.includes('LINE='));
  assert.ok(lineAssembly.length >= 2, 'latest lesson metadata should be rendered in both output branches');
  const lessonBeforeLinks = shellSource.split('\n').filter(l => /^\s*LINE=.*LATEST_LESSON_LINK.*DASHBOARD_LINK/.test(l));
  assert.strictEqual(lessonBeforeLinks.length, 0, 'latest lesson link should not appear before Dashboard/Lessons links');
});
