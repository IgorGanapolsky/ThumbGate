// The local dashboard, walked the way a new user walks it. Nothing is mocked:
//   1. a fresh project folder and a fresh HOME (no license, no prior data);
//   2. thumbs captured with the real CLI (`thumbgate feedback ...`), plus one agent thumbs-down captured the way the
//      MCP capture_feedback tool records it (with the conversation, so it can become a DPO pair);
//   3. `thumbgate dashboard --open` started from that folder, exactly as the docs tell users to run it;
//   4. the browser opens the URL the CLI printed, checks the counts, opens every tab, and downloads DPO pairs.
// On 2026-11-27 this path was broken twice while every mocked test passed: /project-switcher.js was served as
// application/octet-stream (the browser refused it and the dashboard stuck on "Sign in"), and DPO download gave
// nothing. THUMBGATE_CLI points the journey at another build, e.g. the npm release the daily run installs.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawnSync, execFileSync } = require('node:child_process');

const CLI = path.resolve(process.env.THUMBGATE_CLI || path.join(__dirname, '..', '..', 'bin', 'cli.js'));
const PKG_ROOT = path.dirname(path.dirname(CLI));
const REJECTED_COMMAND = 'npm install --force';
const CORRECTION = 'Run npm ci so the install matches package-lock.json exactly.';

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function runCli(args, env, cwd) {
  const res = spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8', timeout: 60_000 });
  if (res.status !== 0) {
    throw new Error(`thumbgate ${args.join(' ')} exited ${res.status}\n${res.stdout}\n${res.stderr}`);
  }
  return `${res.stdout}\n${res.stderr}`;
}

async function startUserDashboard({ pro }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-journey-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  execFileSync('git', ['init', '-q', project]);
  if (pro) {
    // How a paying user's machine looks after activation: a saved key in ~/.thumbgate/license.json.
    fs.mkdirSync(path.join(home, '.thumbgate'), { recursive: true });
    fs.writeFileSync(path.join(home, '.thumbgate', 'license.json'), JSON.stringify({ key: 'tg_pro_journey_test_key' }));
  }
  const port = await freePort();
  const env = {
    ...process.env,
    // A user's shell sets PWD to the folder they are in; the CLI resolves the project from it.
    PWD: project,
    HOME: home,
    USERPROFILE: home,
    PORT: String(port),
    THUMBGATE_DASHBOARD_NO_OPEN: '1',
    THUMBGATE_NO_TELEMETRY: '1',
    DO_NOT_TRACK: '1',
  };
  for (const key of Object.keys(env)) {
    if (/^THUMBGATE_.*(?:_API_KEY|_PRO_KEY)$|^THUMBGATE_LICENSE/.test(key)) delete env[key];
  }
  for (const key of ['THUMBGATE_FEEDBACK_DIR', 'THUMBGATE_PROJECT_DIR', 'CLAUDE_PROJECT_DIR', 'INIT_CWD']) delete env[key];

  runCli(['feedback', '--feedback=up', '--context=Ran the tests before pushing', '--what-worked=Ran npm test before git push'], env, project);
  runCli(['feedback', '--feedback=down', '--context=Pushed to main without running the tests',
    '--what-went-wrong=Skipped the tests and broke the main branch build',
    '--what-to-change=Run npm test before every git push'], env, project);

  // The agent path: MCP capture_feedback records the conversation, which gives the thumbs-down a rejected action.
  const agentCapture = spawnSync(process.execPath, ['-e', `
    const { captureFeedback } = require(${JSON.stringify(path.join(PKG_ROOT, 'scripts', 'feedback-loop.js'))});
    const r = captureFeedback({
      cwd: process.cwd(),
      signal: 'down',
      context: 'Agent forced a fresh install to fix a lockfile mismatch in CI.',
      whatWentWrong: 'It ignored the lockfile and pulled newer versions than CI pins.',
      whatToChange: ${JSON.stringify(CORRECTION)},
      chatHistory: [
        { role: 'user', content: 'CI fails with "lockfile out of sync". Fix it.' },
        { role: 'assistant', content: ${JSON.stringify(REJECTED_COMMAND)} },
      ],
      reviewOrigin: 'human',
    });
    if (!r || !r.accepted) { console.error(JSON.stringify(r)); process.exit(1); }
  `], { cwd: project, env, encoding: 'utf8', timeout: 60_000 });
  if (agentCapture.status !== 0) throw new Error(`agent capture failed: ${agentCapture.stderr}`);

  const out = runCli(['dashboard', '--open'], env, project);
  const url = (out.match(/Ready: (http\S+)/) || [])[1];
  const pid = Number((out.match(/API \d+ pid (\d+)/) || [])[1]) || null;
  if (!url) throw new Error(`dashboard --open printed no URL:\n${out}`);
  return { root, home, project, port, url, pid };
}

function stopUserDashboard(ctx) {
  if (ctx && ctx.pid) {
    try { process.kill(ctx.pid); } catch { /* already gone */ }
  }
  if (ctx && ctx.root) fs.rmSync(ctx.root, { recursive: true, force: true });
}

function trackPageErrors(page) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    // A script the browser refused to run (wrong MIME type, CSP) is a broken page, not noise.
    if (msg.type() === 'error' && /Refused to (execute|apply|load)/.test(msg.text())) errors.push(`console: ${msg.text()}`);
  });
  return errors;
}

test.describe('free user, fresh install', () => {
  test.describe.configure({ mode: 'serial' });
  let ctx;
  test.beforeAll(async () => { ctx = await startUserDashboard({ pro: false }); });
  test.afterAll(() => stopUserDashboard(ctx));

  test('dashboard --open lands signed in with the feedback just captured', async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto(ctx.url);
    await expect(page.locator('#projectSwitcher')).toBeVisible();
    await expect(page.locator('#authTitle')).not.toHaveText('Sign in to ThumbGate');
    await expect(page.locator('#statTotal')).toHaveText(/^[1-9]\d*$/);
    const total = Number(await page.locator('#statTotal').textContent());
    expect(total, 'all three captured thumbs are counted').toBeGreaterThanOrEqual(3);
    expect(errors).toEqual([]);
  });

  test('every dashboard tab opens without a page error', async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto(ctx.url);
    await expect(page.locator('#statTotal')).toHaveText(/^\d+$/);
    const tabs = page.locator('.tabs .tab, div.tab[onclick^="switchTab"]');
    const count = await tabs.count();
    expect(count, 'dashboard has tabs').toBeGreaterThanOrEqual(5);
    for (let i = 0; i < count; i += 1) {
      const tab = tabs.nth(i);
      const name = ((await tab.getAttribute('onclick')) || '').match(/switchTab\('([^']+)'\)/)?.[1];
      await tab.click();
      await expect(tab, `tab ${name} becomes active`).toHaveClass(/\bactive\b/);
      if (name) await expect(page.locator(`#tab-${name}`), `panel for ${name} is shown`).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test('Export > Download DPO Pairs tells a free user it needs Pro, with the way to upgrade', async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto(ctx.url);
    await expect(page.locator('#statTotal')).toHaveText(/^\d+$/);
    await page.locator('div.tab[onclick="switchTab(\'export\')"]').click();
    await page.getByRole('button', { name: /Download DPO Pairs/ }).click();
    await expect(page.locator('#exportStatus')).toContainText(/requires Pro/i);
    await expect(page.locator('#exportStatus')).toContainText(/Upgrade/i);
    await expect(page.getByRole('button', { name: 'Talk to us' })).toBeVisible();
    expect(errors).toEqual([]);
  });


  // Known bugs found by walking this path on 2026-11-27. test.fail() keeps the run green while the bug stands and
  // turns red the day it is fixed, so whoever fixes it removes the marker.
  test('a free user is not told a Pro license is active', async ({ page }) => {
    test.fail(true, 'Known bug 2026-11-27: loopback dashboards say "Pro License Active" with no license saved');
    await page.goto(ctx.url);
    await expect(page.locator('#statTotal')).toHaveText(/^\d+$/);
    await expect(page.locator('body')).not.toContainText('Pro License Active', { timeout: 3_000 });
  });

  test('the Pro-required export message has a clickable upgrade link', async ({ page }) => {
    test.fail(true, 'Known bug 2026-11-27: the message says "Upgrade at /pricing" as plain text, with no link to click');
    await page.goto(ctx.url);
    await expect(page.locator('#statTotal')).toHaveText(/^\d+$/);
    await page.locator('div.tab[onclick="switchTab(\'export\')"]').click();
    await page.getByRole('button', { name: /Download DPO Pairs/ }).click();
    await expect(page.locator('#exportStatus')).toContainText(/requires Pro/i);
    await expect(page.locator('#exportStatus a[href*="pricing"], #exportStatus a[href*="checkout"]')).toBeVisible({ timeout: 3_000 });
  });

  test('the Lessons page tells a free user lesson search needs Pro, not that data is temporarily unavailable', async ({ page }) => {
    test.fail(true, 'Known bug 2026-11-27: /v1/lessons/search answers 429 for free users and the page says "temporarily unavailable"');
    await page.goto(ctx.url.replace('/dashboard', '/lessons'));
    await expect(page.locator('body')).toContainText(/Pro/);
    await expect(page.locator('body')).not.toContainText('temporarily unavailable', { timeout: 3_000 });
  });
});

test.describe('Pro user, license saved on the machine', () => {
  test.describe.configure({ mode: 'serial' });
  let ctx;
  test.beforeAll(async () => { ctx = await startUserDashboard({ pro: true }); });
  test.afterAll(() => stopUserDashboard(ctx));

  test('Lessons page opens from the dashboard and lists the captured lessons', async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto(ctx.url);
    await expect(page.locator('#statTotal')).toHaveText(/^\d+$/);
    await page.getByRole('link', { name: 'Lessons', exact: true }).first().click();
    await expect(page).toHaveURL(/\/lessons/);
    await expect(page.locator('body')).toContainText(/lockfile|tests/i);
    expect(errors).toEqual([]);
  });


  test('Export > Download DPO Pairs saves a file with the recorded pair', async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto(ctx.url);
    await expect(page.locator('#statTotal')).toHaveText(/^\d+$/);
    await page.locator('div.tab[onclick="switchTab(\'export\')"]').click();
    const button = page.getByRole('button', { name: /Download DPO Pairs/ });
    await expect(button).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20_000 }).catch(() => null),
      button.click(),
    ]);
    const status = (await page.locator('#exportStatus').textContent()) || '';
    expect(download, `a file downloads (status shown: "${status.trim()}")`).not.toBeNull();
    const body = fs.readFileSync(await download.path(), 'utf8');
    const pairs = JSON.parse(body);
    expect(Array.isArray(pairs) && pairs.length, 'the file holds at least one pair').toBeGreaterThanOrEqual(1);
    const pair = pairs.find((p) => String(p.rejected).includes(REJECTED_COMMAND));
    expect(pair, 'the agent thumbs-down became a pair').toBeTruthy();
    expect(pair.chosen).toContain('npm ci');
    expect(String(pair.prompt)).toContain('lockfile out of sync');
    await expect(page.locator('#exportStatus')).toContainText(/Exported \d+ preference pair/);
    expect(errors).toEqual([]);
  });
});
