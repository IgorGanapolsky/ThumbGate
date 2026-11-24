'use strict';

// AGENT-3667, 24 Nov 2026: Igor saw three different thumb counts (53 on the status line, 32 on the dashboard,
// 56 in the hook's "Stats:" line) for one project. Every surface now reads one function, computeHumanCounts.
// This test builds a project with a known log and checks that the real status line command, the real dashboard
// server, the real hook and a headless browser reading the dashboard page all print the same two numbers, and
// that those numbers equal the ones written below, by hand, from the fixture rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
// HOME is replaced below so the test never reads or writes a real feedback store; keep the browser cache findable.
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-onecount-home-')));
const projectDir = path.join(home, 'work', 'onecount-demo');
fs.mkdirSync(path.join(projectDir, '.thumbgate'), { recursive: true });
process.env.HOME = home;
for (const name of ['THUMBGATE_PROJECT_DIR', 'CLAUDE_PROJECT_DIR', 'INIT_CWD', 'THUMBGATE_FEEDBACK_DIR']) delete process.env[name];
const apiKey = crypto.randomUUID();
process.env.THUMBGATE_API_KEY = apiKey;
process.env.THUMBGATE_AGGREGATE_FEEDBACK = '0';
process.env.THUMBGATE_NO_RATE_LIMIT = '1';

const { resolveLocalProject } = require('../../scripts/project-identity');
const { projectKey } = resolveLocalProject(projectDir);

let n = 0;
const at = () => new Date(Date.now() - 600000 + (n += 1) * 1000).toISOString();
const row = (fields) => ({ id: `fb_fixture_${n + 1}`, timestamp: at(), reviewOrigin: 'human', tags: [], ...fields });
const agentScope = { sessionId: 'session_fixture', projectId: 'agent' };
const OTHER = '[Eci.Psn.StockService] ';

// Expected counts, written by hand from the rules: a person's thumb for this project counts; a row with no
// project key counts only with the user-prompt tag; an agent's own store-learning row never counts; a row naming
// another project never counts. Rows of the same kind exist for thumbs-down.
const FIXTURE = [
  row({ signal: 'up', projectKey, context: 'Igor: thumbs up, the answer was short and checked.' }), // counts (up 1)
  row({ signal: 'up', context: 'Igor: thumbs up, good.', tags: ['user-prompt-thumbs'] }), // counts, tagged by the prompt hook (up 2)
  row({ signal: 'up', reviewOrigin: 'automated', actionType: 'store-learning', scope: agentScope, context: 'Verified the deploy and recorded a success.' }), // agent positive
  row({ signal: 'up', projectKey, context: `${OTHER}Igor: thumbs up` }), // another project
  row({ signal: 'up', context: 'Explicit user thumbs-up' }), // no key, no evidence
  row({ signal: 'down', projectKey, context: 'Igor: thumbs down, it called the work done without checking.' }), // counts (down 1)
  row({ signal: 'down', context: 'Igor: thumbs down, too long.', tags: ['user-prompt-thumbs'] }), // counts (down 2)
  row({ signal: 'down', reviewOrigin: 'automated', actionType: 'store-mistake', scope: agentScope, context: 'The agent noticed a missed check.' }), // agent negative
  row({ signal: 'down', projectKey, context: `${OTHER}Igor: thumbs down` }), // another project
  row({ signal: 'down', context: 'Explicit user thumbs-down' }), // no key, no evidence
];
// The hook below adds one real thumbs-up from a person, so every surface should then read 3 up and 2 down.
const EXPECTED = { up: 3, down: 2 };

fs.writeFileSync(path.join(projectDir, '.thumbgate', 'feedback-log.jsonl'), `${FIXTURE.map((r) => JSON.stringify(r)).join('\n')}\n`);

const cleanEnv = () => {
  // PWD is what a shell sets for the project folder; a child inherits the test runner's otherwise.
  const env = { ...process.env, HOME: home, THUMBGATE_API_KEY: '', PWD: projectDir };
  for (const name of ['THUMBGATE_PROJECT_DIR', 'CLAUDE_PROJECT_DIR', 'INIT_CWD', 'THUMBGATE_FEEDBACK_DIR']) delete env[name];
  return env;
};
const strip = (text) => text.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;]*m/g, '');

const surfaces = {};

test('hook: the real cli-feedback script records a person\'s thumb and prints Stats', () => {
  const out = strip(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'cli-feedback.js'), 'up', 'Igor: thumbs up, the count matched on every screen.'], { cwd: projectDir, env: cleanEnv(), encoding: 'utf8' }));
  const match = out.match(/Stats:\s*(\d+)👍\s*(\d+)👎/);
  assert.ok(match, `no Stats line in hook output: ${out.slice(0, 400)}`);
  surfaces.hook = { up: Number(match[1]), down: Number(match[2]) };
  assert.deepEqual(surfaces.hook, EXPECTED);
});

test('status line: the real statusline-render command prints the same numbers', () => {
  const input = JSON.stringify({ workspace: { current_dir: projectDir }, cwd: projectDir, model: { display_name: 'Sonnet' } });
  const out = strip(execFileSync(process.execPath, [path.join(ROOT, 'bin', 'cli.js'), 'statusline-render'], { cwd: projectDir, input, env: cleanEnv(), encoding: 'utf8' }));
  const match = out.match(/(\d+)\s*👍\s*(\d+)\s*👎\s*this project/);
  assert.ok(match, `no thumb counts in status line: ${out.slice(0, 400)}`);
  surfaces.statusLine = { up: Number(match[1]), down: Number(match[2]) };
  assert.deepEqual(surfaces.statusLine, EXPECTED);
});

test('dashboard server and headless browser read the same numbers', async () => {
  const { server, port } = await require('../../src/api/server').startServer({ host: '127.0.0.1', port: 0 });
  const origin = `http://127.0.0.1:${port}`;
  const query = `project=${encodeURIComponent(projectKey)}&projectDir=${encodeURIComponent(projectDir)}`;
  let browser;
  try {
    // The page's own stats call: renderStats() in public/dashboard.html reads this endpoint.
    const res = await fetch(`${origin}/v1/feedback/stats?${query}`, { headers: { authorization: `Bearer ${apiKey}` } });
    assert.equal(res.status, 200);
    const data = await res.json();
    surfaces.api = { up: data.totalPositive ?? data.positive, down: data.totalNegative ?? data.negative };
    assert.deepEqual(surfaces.api, EXPECTED);

    const { chromium } = require('playwright');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { authorization: `Bearer ${apiKey}` } });
    await page.route('**/*', (route) => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
    await page.goto(`${origin}/dashboard?${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /^\d+$/.test((document.getElementById('statTotal') || {}).textContent?.trim() || ''), null, { timeout: 25000 });
    await page.waitForTimeout(1000);
    const headline = await page.evaluate(() => ({
      up: Number(document.getElementById('statPositive').textContent.trim()),
      down: Number(document.getElementById('statNegative').textContent.trim()),
    }));
    surfaces.dashboardPage = headline;
    assert.deepEqual(headline, EXPECTED);
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('all four surfaces agree', () => {
  assert.deepEqual(Object.keys(surfaces).sort(), ['api', 'dashboardPage', 'hook', 'statusLine']);
  for (const [name, counts] of Object.entries(surfaces)) assert.deepEqual(counts, EXPECTED, `${name} disagrees`);
});

test.after(() => fs.rmSync(home, { recursive: true, force: true }));
