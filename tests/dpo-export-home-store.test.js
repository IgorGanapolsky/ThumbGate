'use strict';

// A dashboard started in a folder that has its own .thumbgate (for example ~/workspace) never read the main store at
// ~/.thumbgate, so "All projects" downloaded nothing while the main store held pairable feedback.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-home-store-'));
const home = path.join(root, 'home');
const homeDir = path.join(home, '.thumbgate');
const folder = path.join(home, 'workspace');
const folderDir = path.join(folder, '.thumbgate');
const key = crypto.randomUUID();

function seed(dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  const timestamp = new Date().toISOString();
  const feedback = {
    id: `fb-${name}`, signal: 'negative', timestamp,
    context: `The ${name} branch was force pushed and lost work`,
    whatWentWrong: `The ${name} branch was force pushed and lost work`,
    whatToChange: 'rebase on origin/main and push without force',
    lastAction: { tool: 'Bash', command: `git push --force origin ${name}` },
    conversationWindow: [{ role: 'user', content: `Get the ${name} branch onto main` }],
  };
  const memory = { id: `mem-${name}`, category: 'error', title: `MISTAKE: ${name}`, content: feedback.context, sourceFeedbackId: feedback.id, timestamp };
  fs.writeFileSync(path.join(dir, 'feedback-log.jsonl'), `${JSON.stringify(feedback)}\n`);
  fs.writeFileSync(path.join(dir, 'memory-log.jsonl'), `${JSON.stringify(memory)}\n`);
}

const bytes = (dir) => ['feedback-log.jsonl', 'memory-log.jsonl'].map((n) => fs.readFileSync(path.join(dir, n), 'utf8')).join('');

test('project=all from a non-home folder includes the home store, read-only', async (t) => {
  seed(homeDir, 'homestore');
  seed(folderDir, 'folderstore');
  const previousEnv = { ...process.env };
  const previousCwd = process.cwd();
  Object.assign(process.env, {
    HOME: home, THUMBGATE_FEEDBACK_DIR: folderDir, THUMBGATE_API_KEY: key, THUMBGATE_PRO_MODE: '1',
    THUMBGATE_AGGREGATE_FEEDBACK: '0', _TEST_THUMBGATE_FALLBACK_FEEDBACK_DIR: folderDir, _TEST_LEGACY_FEEDBACK_DIR: folderDir,
    _TEST_API_KEYS_PATH: path.join(root, 'keys.json'), _TEST_FUNNEL_LEDGER_PATH: path.join(root, 'funnel.jsonl'),
    _TEST_REVENUE_LEDGER_PATH: path.join(root, 'revenue.jsonl'),
  });
  for (const name of ['THUMBGATE_PROJECT_DIR', 'CLAUDE_PROJECT_DIR', 'INIT_CWD', 'RAILWAY_ENVIRONMENT']) delete process.env[name];
  process.chdir(folder);
  const { server, port } = await require('../src/api/server').startServer({ host: '127.0.0.1', port: 0 });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    process.chdir(previousCwd);
    for (const name of Object.keys(process.env)) if (!(name in previousEnv)) delete process.env[name];
    Object.assign(process.env, previousEnv);
    fs.rmSync(root, { recursive: true, force: true });
  });

  const before = bytes(homeDir) + bytes(folderDir);
  const exportWith = async (query) => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/dpo/export${query}`, {
      method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ includePairs: true }),
    });
    assert.equal(res.status, 200);
    return res.json();
  };

  const all = await exportWith('?project=all');
  assert.equal(all.homeStoreMemories, 1);
  assert.equal(all.errors, 2);
  assert.equal(all.pairCount, 2);
  assert.equal(all.ktoCount, 2);
  assert.deepEqual(all.records.map((p) => p.rejected).sort(), ['git push --force origin folderstore', 'git push --force origin homestore']);

  // Without the explicit "all", the request stays inside its own store.
  const own = await exportWith('');
  assert.equal(own.homeStoreMemories, 0);
  assert.equal(own.pairCount, 1);

  // A caller that names another host (a deployed server behind a proxy) never gets the home directory.
  const http = require('node:http');
  const remote = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/v1/dpo/export?project=all', method: 'POST', headers: { host: 'thumbgate.example', authorization: `Bearer ${key}`, 'content-type': 'application/json' } }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve(JSON.parse(text)));
    });
    req.on('error', reject);
    req.end('{}');
  });
  assert.equal(remote.homeStoreMemories, 0);
  assert.equal(remote.errors, 1);

  assert.equal(bytes(homeDir) + bytes(folderDir), before, 'feedback files are only read');
});

test('the dashboard Download button asks for all projects when none is selected', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');
  assert.match(page, /projectFetch\('\/v1\/dpo\/export\?project=all'/);
});
