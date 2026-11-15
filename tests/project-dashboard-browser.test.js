'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

// Run with npm run test:project-browser after npx playwright install chromium --only-shell.
// This test creates its own isolated account and always launches headless Chromium.
test('dashboard and Lessons preserve selection and display actual selected records', {
  skip: process.env.THUMBGATE_PROJECT_BROWSER_TEST !== '1', timeout: 60000,
}, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-browser-'));
  const key = crypto.randomUUID();
  const previous = { ...process.env };
  Object.assign(process.env, { THUMBGATE_FEEDBACK_DIR: root, THUMBGATE_API_KEY: key, THUMBGATE_AGGREGATE_FEEDBACK: '0', _TEST_THUMBGATE_FALLBACK_FEEDBACK_DIR: root, _TEST_LEGACY_FEEDBACK_DIR: root, _TEST_API_KEYS_PATH: path.join(root, 'keys.json'), _TEST_FUNNEL_LEDGER_PATH: path.join(root, 'funnel.jsonl'), _TEST_REVENUE_LEDGER_PATH: path.join(root, 'revenue.jsonl') });
  for (const name of ['THUMBGATE_PROJECT_DIR', 'CLAUDE_PROJECT_DIR', 'INIT_CWD']) delete process.env[name];
  t.after(() => { for (const name of Object.keys(process.env)) if (!(name in previous)) delete process.env[name]; Object.assign(process.env, previous); fs.rmSync(root, { recursive: true, force: true }); });
  const { projectFromRemote } = require('../scripts/project-identity');
  const a = projectFromRemote('https://github.com/fixture/alpha', 'Alpha');
  const b = projectFromRemote('https://github.com/fixture/beta', 'Beta');
  const rows = [a, b, b].map((project, index) => ({ ...project, id: 'feedback-' + index, signal: index ? 'positive' : 'negative', context: index ? 'BETA_ONLY_SENTINEL validated repository transaction' : 'ALPHA_ONLY_SENTINEL rollback the failed transaction', whatToChange: 'Validate before committing the transaction', whatWorked: 'Validation passed before the commit', tags: ['database'], reviewOrigin: 'human', timestamp: new Date().toISOString() }));
  fs.writeFileSync(path.join(root, 'feedback-log.jsonl'), rows.map(JSON.stringify).join('\n') + '\n');
  fs.writeFileSync(path.join(root, 'memory-log.jsonl'), rows.slice(0, 2).map((row, index) => JSON.stringify({ ...row, id: 'memory-' + index, sourceFeedbackId: row.id, category: index ? 'learning' : 'error', title: row.context, content: row.context })).join('\n') + '\n');
  fs.writeFileSync(path.join(root, 'custom-gates.json'), JSON.stringify({ gates: [{ ...a, id: 'alpha-gate', scope: 'project', pattern: 'alpha-fixture', action: 'warn', updatedAt: rows[0].timestamp }, { ...b, id: 'beta-gate', scope: 'project', pattern: 'beta-fixture', action: 'warn', promotedAt: rows[1].timestamp }] }));
  const { server, port } = await require('../src/api/server').startServer({ host: '127.0.0.1', port: 0 });
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const origin = `http://127.0.0.1:${port}`;
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ extraHTTPHeaders: { authorization: 'Bearer ' + key } });
  await page.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin + '/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#projectSwitcher option')?.textContent === 'All projects' && document.querySelectorAll('#projectSwitcher option').length >= 3);
  for (const [project, feedbackCount] of [[a, 1], [b, 2]]) {
    const card = page.locator('#projectCards a').filter({ has: page.locator('strong', { hasText: project.projectName }) });
    const text = await card.innerText();
    assert(text.includes(feedbackCount + ' feedback · 1 lessons · 1 active gates'));
    assert(text.includes('Last activity '));
    assert(!text.includes('No recorded activity'));
    assert((await card.getAttribute('href')).includes(project.projectKey));
  }
  assert.match(await page.locator('#projectGlobalGates').innerText(), /^\d+ global gates shared across projects$/);
  await page.selectOption('#projectSwitcher', b.projectKey);
  await page.waitForURL('**project=' + b.projectKey);
  await page.waitForFunction(() => document.querySelector('#projectStatus')?.textContent === 'Beta' && document.querySelector('#statTotal')?.textContent === '2');
  const lessons = page.locator('a[href^="/lessons"]').first();
  await lessons.click();
  await page.waitForURL('**/lessons?project=' + b.projectKey);
  await page.waitForFunction(() => document.body.innerText.includes('BETA_ONLY_SENTINEL'));
  assert(!(await page.locator('body').innerText()).includes('ALPHA_ONLY_SENTINEL'));
  assert.equal(await page.locator('#projectSwitcher').inputValue(), b.projectKey);
  await page.selectOption('#projectSwitcher', a.projectKey);
  await page.waitForURL('**project=' + a.projectKey);
  await page.waitForFunction(() => document.querySelector('#projectStatus')?.textContent === 'Alpha' && document.body.innerText.includes('ALPHA_ONLY_SENTINEL'));
  assert(!(await page.locator('body').innerText()).includes('BETA_ONLY_SENTINEL'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.innerText.includes('ALPHA_ONLY_SENTINEL'));
  assert.equal(await page.locator('#projectSwitcher').inputValue(), a.projectKey);
});
