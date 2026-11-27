'use strict';

// Guards the path a user takes on a fresh install: open the local dashboard, go to Export, press Download.
// On 2026-11-27 that path opened on "Project with no recorded activity" (a link naming a project with nothing
// recorded) and the download had nothing in it, while the same machine held real feedback. Two checks:
//   1. API: a store of ordinary 👍/👎 (tool name only in lastAction, no correction) still exports KTO rows,
//      in TRL's { prompt, completion, label } shape, and the prompt never contains the completion.
//   2. Browser: a dashboard link naming an empty project moves to the project with data, and Download
//      saves a file with real rows. Runs when headless Chromium can launch (it is pre-installed in cloud
//      sessions; `npx playwright install chromium` elsewhere), and skips with a reason otherwise.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { projectFromRemote } = require('../scripts/project-identity');
const { exportDpoFromMemories } = require('../scripts/export-dpo-pairs');

const project = projectFromRemote('https://github.com/fixture/training-export', 'training-export');
const now = new Date().toISOString();

function seedRows() {
  const feedback = [
    {
      ...project, id: 'fb-down', signal: 'negative', timestamp: now,
      context: 'It deleted the migration file instead of fixing the failing column type.',
      whatWentWrong: 'It deleted the migration file instead of fixing the failing column type.',
      lastAction: { tool: 'Bash' },
      conversationWindow: [
        { role: 'user', content: 'The users migration fails on the email column. Fix it.' },
        { role: 'assistant', content: 'Removed db/migrate/001_users.rb so the migration no longer fails.' },
      ],
    },
    {
      ...project, id: 'fb-up', signal: 'positive', timestamp: now,
      context: 'Ran the focused test before committing.',
      whatWorked: 'Ran the focused test before committing.',
      conversationWindow: [
        { role: 'user', content: 'Add a test for the email validator, then commit.' },
        { role: 'assistant', content: 'Added tests/email.test.js, ran node --test tests/email.test.js (3 passed), then committed.' },
      ],
    },
    { ...project, id: 'fb-bare', signal: 'negative', timestamp: now, context: 'this is wrong', whatWentWrong: 'this is wrong' },
  ];
  const memories = [
    { ...project, id: 'mem-down', category: 'error', title: 'MISTAKE: deleted a migration', content: feedback[0].context, sourceFeedbackId: 'fb-down', timestamp: now },
    { ...project, id: 'mem-up', category: 'learning', title: 'SUCCESS: tested before commit', content: feedback[1].context, sourceFeedbackId: 'fb-up', timestamp: now },
    { ...project, id: 'mem-bare', category: 'error', title: 'MISTAKE: this is wrong', content: 'this is wrong', sourceFeedbackId: 'fb-bare', timestamp: now },
  ];
  return { feedback, memories };
}

test('ordinary 👍/👎 with no correction still export as TRL KTO rows, with skip reasons for the rest', () => {
  const { feedback, memories } = seedRows();
  const result = exportDpoFromMemories(memories, { feedbackRows: feedback });
  assert.equal(result.pairs.length, 0, 'no correction was written, so there is no DPO pair');
  assert.equal(result.ktoRecords.length, 2);
  const byLabel = Object.fromEntries(result.ktoRecords.map((row) => [String(row.label), row]));
  assert.equal(byLabel.false.completion, 'Removed db/migrate/001_users.rb so the migration no longer fails.');
  assert.match(byLabel.false.prompt, /^user: The users migration fails/);
  assert.equal(byLabel.true.label, true);
  assert.match(byLabel.true.completion, /ran node --test/);
  for (const row of result.ktoRecords) {
    assert.equal(typeof row.prompt, 'string');
    assert.equal(typeof row.completion, 'string');
    assert.equal(typeof row.label, 'boolean');
    assert.ok(!row.prompt.includes(row.completion), 'prompt is cut before the completion');
  }
  assert.deepEqual(result.ktoSkippedByReason, { no_agent_action_recorded: 1 });
});

async function launchChromium() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (error) { return { skip: 'playwright is not installed' }; }
  try { return await chromium.launch({ headless: true }); } catch (error) {
    // A Chromium installed for another Playwright version (cloud sessions ship one at this path).
    const fallback = process.env.THUMBGATE_CHROMIUM_PATH || '/opt/pw-browsers/chromium';
    if (fs.existsSync(fallback)) return chromium.launch({ headless: true, executablePath: fallback, args: ['--no-sandbox'] });
    return { skip: `headless Chromium unavailable: ${String(error.message).split('\n')[0]}` };
  }
}

test('a link to an empty project moves to the project with data, and Download saves real rows', { timeout: 90000 }, async (t) => {
  const browser = await launchChromium();
  if (browser.skip) { t.skip(browser.skip); return; }
  t.after(() => browser.close());

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-training-export-'));
  const key = crypto.randomUUID();
  const previous = { ...process.env };
  Object.assign(process.env, { THUMBGATE_FEEDBACK_DIR: root, THUMBGATE_API_KEY: key, THUMBGATE_PRO_MODE: '1', THUMBGATE_AGGREGATE_FEEDBACK: '0', _TEST_THUMBGATE_FALLBACK_FEEDBACK_DIR: root, _TEST_LEGACY_FEEDBACK_DIR: root, _TEST_API_KEYS_PATH: path.join(root, 'keys.json'), _TEST_FUNNEL_LEDGER_PATH: path.join(root, 'funnel.jsonl'), _TEST_REVENUE_LEDGER_PATH: path.join(root, 'revenue.jsonl') });
  for (const name of ['THUMBGATE_PROJECT_DIR', 'CLAUDE_PROJECT_DIR', 'INIT_CWD']) delete process.env[name];
  t.after(() => { for (const name of Object.keys(process.env)) if (!(name in previous)) delete process.env[name]; Object.assign(process.env, previous); fs.rmSync(root, { recursive: true, force: true }); });
  const { feedback, memories } = seedRows();
  fs.writeFileSync(path.join(root, 'feedback-log.jsonl'), feedback.map((row) => JSON.stringify(row)).join('\n') + '\n');
  fs.writeFileSync(path.join(root, 'memory-log.jsonl'), memories.map((row) => JSON.stringify(row)).join('\n') + '\n');

  const { server, port } = await require('../src/api/server').startServer({ host: '127.0.0.1', port: 0 });
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const origin = `http://127.0.0.1:${port}`;

  const context = await browser.newContext({ acceptDownloads: true, extraHTTPHeaders: { authorization: 'Bearer ' + key } });
  const page = await context.newPage();
  await page.route('**/*', (route) => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
  // The exact shape of the link that opened empty: a local_ key with nothing recorded under it.
  const emptyKey = 'local_' + 'e'.repeat(64);
  await page.goto(`${origin}/dashboard?project=${emptyKey}#export`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL((url) => url.searchParams.get('project') === project.projectKey, { timeout: 20000 });
  assert.equal(new URL(page.url()).searchParams.get('moved'), 'empty');
  await page.waitForFunction(() => /where your data is/.test(document.querySelector('#projectStatus')?.textContent || ''));
  await page.waitForFunction(() => document.querySelector('#statTotal')?.textContent === '3', null, { timeout: 20000 });

  await page.evaluate(() => switchTab('export'));
  const downloadPromise = page.waitForEvent('download');
  await page.locator('.export-btn').click();
  const download = await downloadPromise;
  const file = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  assert.equal(file.format, 'thumbgate-training-data/v1');
  assert.ok(Array.isArray(file.dpo));
  assert.equal(file.kto.length, 2, 'both usable thumbs are in the file');
  assert.ok(file.kto.every((row) => row.prompt && row.completion && typeof row.label === 'boolean'));
  await page.waitForFunction(() => /Downloaded 0 DPO pairs and 2 labeled/.test(document.querySelector('#exportStatus')?.textContent || ''));
});

test('the dashboard scripts are served as JavaScript, and the export endpoint returns the KTO rows', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-training-api-'));
  const key = crypto.randomUUID();
  const previous = { ...process.env };
  Object.assign(process.env, { THUMBGATE_FEEDBACK_DIR: root, THUMBGATE_API_KEY: key, THUMBGATE_AGGREGATE_FEEDBACK: '0', _TEST_THUMBGATE_FALLBACK_FEEDBACK_DIR: root, _TEST_LEGACY_FEEDBACK_DIR: root, _TEST_API_KEYS_PATH: path.join(root, 'keys.json'), _TEST_FUNNEL_LEDGER_PATH: path.join(root, 'funnel.jsonl'), _TEST_REVENUE_LEDGER_PATH: path.join(root, 'revenue.jsonl') });
  for (const name of ['THUMBGATE_PROJECT_DIR', 'CLAUDE_PROJECT_DIR', 'INIT_CWD']) delete process.env[name];
  t.after(() => { for (const name of Object.keys(process.env)) if (!(name in previous)) delete process.env[name]; Object.assign(process.env, previous); fs.rmSync(root, { recursive: true, force: true }); });
  const { feedback, memories } = seedRows();
  fs.writeFileSync(path.join(root, 'feedback-log.jsonl'), feedback.map((row) => JSON.stringify(row)).join('\n') + '\n');
  fs.writeFileSync(path.join(root, 'memory-log.jsonl'), memories.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const { server, port } = await require('../src/api/server').startServer({ host: '127.0.0.1', port: 0 });
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const origin = `http://127.0.0.1:${port}`;

  // An octet-stream switcher with nosniff is refused by the browser and the whole dashboard fails to connect.
  const script = await fetch(`${origin}/project-switcher.js?v=20261127`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /^application\/javascript/);

  const res = await fetch(`${origin}/v1/dpo/export`, { method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: JSON.stringify({ includePairs: true }) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.pairs, 0);
  assert.equal(body.ktoCount, 2);
  assert.equal(body.ktoRecords.length, 2);
  assert.deepEqual(body.ktoSkippedByReason, { no_agent_action_recorded: 1 });
});
