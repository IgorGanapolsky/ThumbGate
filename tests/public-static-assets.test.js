const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-static-test-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmp;
process.env.THUMBGATE_API_KEY = 'test-api-key';
process.env._TEST_API_KEYS_PATH = path.join(tmp, 'api-keys.json');

const { startServer } = require('../src/api/server');
const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');

let handle;
let origin = '';

test.before(async () => {
  handle = await startServer({ port: 0 });
  origin = `http://127.0.0.1:${handle.port}`;
});

test.after(async () => {
  handle.server.closeIdleConnections?.();
  handle.server.closeAllConnections?.();
  await new Promise((resolve) => handle.server.close(resolve));
});

test('GET /assets/instagram-card.png serves image/png without an API key', async () => {
  const res = await fetch(`${origin}/assets/instagram-card.png`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.ok(Number(res.headers.get('content-length')) > 0, 'content-length must be non-zero');
  assert.match(res.headers.get('cache-control') || '', /max-age=/);
});

test('GET /thumbgate-logo.png serves the checkout-ready brand logo without an API key', async () => {
  const res = await fetch(`${origin}/thumbgate-logo.png`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.ok(Number(res.headers.get('content-length')) > 0);
});

test('GET /thumbgate-icon.png and brand assets serve public Stripe images', async () => {
  const [iconRes, checkoutIconRes, proIconRes, teamIconRes, checkoutLogoRes] = await Promise.all([
    fetch(`${origin}/thumbgate-icon.png`),
    fetch(`${origin}/assets/brand/thumbgate-icon-512.png`),
    fetch(`${origin}/assets/brand/thumbgate-icon-pro-512.png`),
    fetch(`${origin}/assets/brand/thumbgate-icon-team-512.png`),
    fetch(`${origin}/assets/brand/thumbgate-logo-1200x360.png`),
  ]);

  for (const res of [iconRes, checkoutIconRes, proIconRes, teamIconRes, checkoutLogoRes]) {
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.ok(Number(res.headers.get('content-length')) > 0);
  }
});

test('GET /assets/tiktok-agent-memory.mp4 serves video/mp4 without an API key', async () => {
  const res = await fetch(`${origin}/assets/tiktok-agent-memory.mp4`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'video/mp4');
  assert.ok(Number(res.headers.get('content-length')) > 0);
});

test('HEAD /assets/... returns headers only', async () => {
  const res = await fetch(`${origin}/assets/instagram-card.png`, { method: 'HEAD' });
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.equal(body, '');
});

test('GET /assets/missing.png returns 404, not 401', async () => {
  const res = await fetch(`${origin}/assets/does-not-exist-${Date.now()}.png`);
  assert.equal(res.status, 404);
  assert.notEqual(res.status, 401, 'must not require an API key for the assets prefix');
});

test('GET /assets/../server.js is rejected (no path traversal)', async () => {
  const res = await fetch(`${origin}/assets/..%2fapi%2fserver.js`);
  assert.ok([403, 404].includes(res.status), `expected 403 or 404, got ${res.status}`);
  assert.notEqual(res.status, 200);
});

test('packaged well-known MCP server card is valid JSON', () => {
  const payload = JSON.parse(fs.readFileSync(path.join(root, '.well-known/mcp/server-card.json'), 'utf8'));
  assert.equal(payload.name, 'thumbgate');
  assert.equal(typeof payload.version, 'string');
});

test('landing page does not render empty revenue links', async () => {
  const res = await fetch(`${origin}/`);
  assert.equal(res.status, 200);
  const html = await res.text();

  assert.doesNotMatch(html, /href=""/, 'rendered landing page must not contain empty href links');
  assert.doesNotMatch(html, /__SPRINT_DIAGNOSTIC_CHECKOUT_URL__|__WORKFLOW_SPRINT_CHECKOUT_URL__/);
  assert.doesNotMatch(html, /https:\/\/buy\.stripe\.com\/28E00j3Uge1E2dzgWL3sI2J/);
  assert.doesNotMatch(html, /https:\/\/buy\.stripe\.com\/6oU00j8aw2iWdWh9uj3sI2K/);
  assert.match(html, /#workflow-sprint-intake/);
  assert.match(html, /Team checkout happens after scope\./);
});

test('landing page internal links resolve without auth or broken .html aliases', async () => {
  const res = await fetch(`${origin}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  const hrefs = Array.from(html.matchAll(/<a\b[^>]*href="([^"]*)"/gi), (match) => match[1])
    .filter((href) => href && href.startsWith('/'))
    .map((href) => href.split('#')[0])
    .filter(Boolean);
  const uniquePaths = Array.from(new Set(hrefs));
  const failures = [];

  for (const pathname of uniquePaths) {
    const target = `${origin}${pathname}`;
    const linkRes = await fetch(target, {
      method: 'HEAD',
      redirect: 'manual',
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (![200, 204, 301, 302, 303, 307, 308].includes(linkRes.status)) {
      failures.push(`${pathname} -> ${linkRes.status}`);
    }
  }

  assert.deepEqual(failures, []);
});

test('public marketing .html aliases remain live for existing indexed links', async () => {
  const paths = [
    '/guide.html',
    '/codex-plugin.html',
    '/compare.html',
    '/learn.html',
    '/guides/claude-desktop.html',
    '/guides/claude-code-prevent-repeated-mistakes.html',
    '/guides/cursor-prevent-repeated-mistakes.html',
    '/compare/mem0.html',
    '/learn/agent-harness-pattern.html',
  ];

  for (const pathname of paths) {
    const res = await fetch(`${origin}${pathname}`, { method: 'HEAD' });
    assert.equal(res.status, 200, `${pathname} should resolve`);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
  }
});

test('public marketing directory aliases redirect to canonical pages', async () => {
  const cases = [
    ['/lessons/', '/lessons'],
    ['/guides', '/learn'],
    ['/guides/', '/learn'],
    ['/guides.html', '/learn'],
    ['/services', '/#workflow-sprint-intake'],
    ['/services.html', '/#workflow-sprint-intake'],
    ['/sprint', '/#workflow-sprint-intake'],
    ['/sprint.html', '/#workflow-sprint-intake'],
    ['/workflow-hardening', '/#workflow-sprint-intake'],
    ['/workflow-hardening.html', '/#workflow-sprint-intake'],
    ['/workflow-hardening-sprint', '/#workflow-sprint-intake'],
    ['/workflow-hardening-sprint.html', '/#workflow-sprint-intake'],
    ['/workflow-sprint', '/#workflow-sprint-intake'],
    ['/workflow-sprint.html', '/#workflow-sprint-intake'],
  ];

  for (const [pathname, expectedLocation] of cases) {
    const res = await fetch(`${origin}${pathname}`, {
      method: 'HEAD',
      redirect: 'manual',
    });
    assert.equal(res.status, 302, `${pathname} should redirect`);
    assert.equal(res.headers.get('location'), expectedLocation);
  }
});

test('public sales copy avoids unsupported pricing, traction, and guarantee claims', async () => {
  const files = [
    'index.html',
    'pro.html',
    'blog.html',
    'guides/claude-code-prevent-repeated-mistakes.html',
    'guides/cursor-prevent-repeated-mistakes.html',
  ];
  const bannedClaims = [
    /money-back guarantee/i,
    /\b(?:money-back|revenue|income|results?) guarantee\b/i,
    /fastest-growing repo/i,
    /100K GitHub stars/i,
    /~?1,700 developers install/i,
    /Zero of them ever saw a checkout button/i,
    /100% of npm users/i,
    /income guarantees?/i,
    /revenue guarantees?/i,
  ];

  for (const file of files) {
    const html = fs.readFileSync(path.join(publicDir, file), 'utf-8');
    for (const claimPattern of bannedClaims) {
      assert.doesNotMatch(html, claimPattern, `${file} contains unsupported claim ${claimPattern}`);
    }
  }
});

test('/checkout/pro interstitial does not assert paying-customer counts or inflated install numbers', async () => {
  // Audit 2026-05-18: the live /checkout/pro interstitial advertised
  // "6 paying customers, 18,000+ installs verified on npm." Verified
  // ground truth: external paying customers = 0 (the only Stripe charge
  // was a founder self-purchase) and real npm last-30-days downloads
  // were 5,257. Both numbers were false trust signals on a buyer-
  // facing surface. Banned forever.
  const res = await fetch(`${origin}/checkout/pro`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.doesNotMatch(html, /\d+\s+paying customers/i, '/checkout/pro must not assert a paying-customer count');
  assert.doesNotMatch(html, /18[,]?000\+?\s+installs/i, '/checkout/pro must not assert an inflated 18,000+ installs claim');
});

test('GET /codex-enterprise serves the Dell partnership landing HTML', async () => {
  const [routeRes, htmlRes] = await Promise.all([
    fetch(`${origin}/codex-enterprise`),
    fetch(`${origin}/codex-enterprise.html`),
  ]);
  for (const res of [routeRes, htmlRes]) {
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    const body = await res.text();
    assert.ok(body.length > 500, 'codex-enterprise page must render non-empty HTML');
  }
});

test('HEAD /codex-enterprise responds 200 with html content-type (no body)', async () => {
  const res = await fetch(`${origin}/codex-enterprise`, { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
});

test('GET /sitemap.xml includes /codex-enterprise at priority 0.85', async () => {
  const res = await fetch(`${origin}/sitemap.xml`);
  assert.equal(res.status, 200);
  const xml = await res.text();
  assert.match(xml, /<loc>[^<]*\/codex-enterprise<\/loc>/, 'sitemap must list /codex-enterprise');
  // The new entry uses priority 0.85 — guards against accidental priority drift.
  const entry = xml.match(/<url>\s*<loc>[^<]*\/codex-enterprise<\/loc>[\s\S]*?<\/url>/);
  assert.ok(entry, 'codex-enterprise <url> block must exist');
  assert.match(entry[0], /<priority>0\.85<\/priority>/);
});

test('GET /agents-cost-savings serves the FinOps-for-AI landing HTML', async () => {
  const [routeRes, htmlRes] = await Promise.all([
    fetch(`${origin}/agents-cost-savings`),
    fetch(`${origin}/agents-cost-savings.html`),
  ]);
  for (const res of [routeRes, htmlRes]) {
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    const body = await res.text();
    assert.ok(body.length > 500, 'agents-cost-savings page must render non-empty HTML');
    // Lock in the prevention-vs-reporting framing and the CLI cross-link —
    // those are the page's reason for existing, not generic agent-cost copy.
    assert.match(body, /prevention/i);
    assert.match(body, /thumbgate cost/i);
  }
});

test('HEAD /agents-cost-savings responds 200 with html content-type', async () => {
  const res = await fetch(`${origin}/agents-cost-savings`, { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
});

test('GET /sitemap.xml includes /agents-cost-savings at priority 0.85', async () => {
  const res = await fetch(`${origin}/sitemap.xml`);
  assert.equal(res.status, 200);
  const xml = await res.text();
  const entry = xml.match(/<url>\s*<loc>[^<]*\/agents-cost-savings<\/loc>[\s\S]*?<\/url>/);
  assert.ok(entry, 'agents-cost-savings <url> block must exist');
  assert.match(entry[0], /<priority>0\.85<\/priority>/);
});
