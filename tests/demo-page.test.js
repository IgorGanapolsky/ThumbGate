'use strict';

// /demo is a chaptered sales walkthrough. Every terminal output on it must stay true to the code,
// so these tests pin the copy to the real gate, the auto-promote thresholds and the free-tier cap.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'demo.html'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'src', 'api', 'server.js'), 'utf8');

test('demo page has five deep-linkable chapters', () => {
  for (const key of ['install', 'block', 'thumbs', 'gate', 'team']) {
    assert.match(html, new RegExp(`id="chapter-${key}"`), `missing chapter ${key}`);
    assert.match(html, new RegExp(`data-chapter="${key}"`), `missing tab ${key}`);
  }
  assert.match(html, /searchParams\.set\('chapter'/);
});

test('server routes /demo and lists it in the sitemap and post-deploy check', () => {
  assert.match(server, /pathname === '\/demo'/);
  assert.match(server, /loadPublicMarketingTemplateHtml\(path\.join\(PUBLIC_DIR, 'demo\.html'\)/);
  assert.match(server, /\{ path: '\/demo'/);
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'post-deploy-marketing-pages.json'), 'utf8'));
  const entry = manifest.pages.find((p) => p.route === '/demo');
  assert.ok(entry, 'post-deploy manifest must include /demo');
  assert.ok(html.includes(entry.sentinel), 'sentinel must be in public/demo.html');
});

test('force-push chapter matches the real built-in gate', () => {
  const defaults = fs.readFileSync(path.join(ROOT, 'config', 'gates', 'default.json'), 'utf8');
  assert.match(defaults, /"id":\s*"force-push"/);
  assert.match(defaults, /Force push blocked/);
  assert.match(html, /\[GATE:force-push\] Force push blocked\./);
});

test('one thumbs-down warns and a second from a person blocks, as the page says', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'auto-promote-gates.js'), 'utf8');
  assert.match(src, /const WARN_THRESHOLD = 1;/);
  assert.match(src, /const HUMAN_BLOCK_THRESHOLD = 2;/);
  assert.match(html, /second thumbs-down from you on the same command upgrades the check from warn to <strong>block<\/strong>/);
});

test('free-tier copy matches the learned-rule cap', () => {
  const { FREE_TIER_MAX_GATES } = require('../scripts/rate-limiter');
  assert.equal(FREE_TIER_MAX_GATES, 3);
  assert.match(html, /Free enforces your first 3 learned rules/);
});

test('team form posts to the pilot intake and the ROI calculator makes no ThumbGate claim', () => {
  assert.match(html, /action="\/v1\/intake\/pilot-request"/);
  assert.match(html, /name="page" value="\/demo"/);
  assert.match(html, /This is arithmetic, not a ThumbGate statistic\./);
  assert.doesNotMatch(html, /checkout\/pro|go\/pro/, 'demo must not deep-link into checkout');
});

test('real server: /demo renders with placeholders filled and the sitemap lists it', async () => {
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-demo-srv-'));
  process.env.THUMBGATE_FEEDBACK_DIR = dir;
  process.env.THUMBGATE_NO_RATE_LIMIT = '1';
  process.env.THUMBGATE_API_KEY = 'test-key-demo';
  const { server, port } = await require('../src/api/server').startServer({ host: '127.0.0.1', port: 0 });
  const origin = `http://127.0.0.1:${port}`;
  try {
    for (const route of ['/demo', '/demo.html', '/demo?chapter=gate']) {
      const res = await fetch(`${origin}${route}`);
      assert.equal(res.status, 200, route);
      const body = await res.text();
      assert.match(body, /See a thumbs-down become a gate\./);
      assert.doesNotMatch(body, /__APP_ORIGIN__|__GA_BOOTSTRAP__|__GOOGLE_SITE_VERIFICATION_META__/);
      assert.match(body, /<link rel="canonical" href="https?:\/\/[^"]+\/demo">/);
    }
    // /pilot used to ship its placeholders raw (canonical "__APP_ORIGIN__/pilot").
    const pilotBody = await (await fetch(`${origin}/pilot`)).text();
    assert.doesNotMatch(pilotBody, /__APP_ORIGIN__|__GA_BOOTSTRAP__|__GOOGLE_SITE_VERIFICATION_META__/);
    const sitemap = await (await fetch(`${origin}/sitemap.xml`)).text();
    assert.match(sitemap, /<loc>[^<]*\/demo<\/loc>/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
