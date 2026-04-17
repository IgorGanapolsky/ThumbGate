const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const markPath = path.join(repoRoot, 'public', 'assets', 'brand', 'thumbgate-mark.svg');
const faviconPngPath = path.join(repoRoot, 'public', 'thumbgate-icon.png');
const ogPngPath = path.join(repoRoot, 'public', 'og.png');

test('ThumbGate brand mark SVG exists at /assets/brand and is a viewBox-defined vector', () => {
  assert.equal(fs.existsSync(markPath), true, 'public/assets/brand/thumbgate-mark.svg must exist');
  const svg = fs.readFileSync(markPath, 'utf8');
  assert.match(svg, /<svg/);
  assert.match(svg, /viewBox="0 0 \d+ \d+"/);
  assert.match(svg, /fill=/);
  assert.match(svg, /<\/svg>/);
});

test('ThumbGate favicon PNG exists for crisp tab and bookmark rendering', () => {
  assert.equal(
    fs.existsSync(faviconPngPath),
    true,
    'public/thumbgate-icon.png must exist for the favicon link tag',
  );
  const buf = fs.readFileSync(faviconPngPath);
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  assert.equal(buf[0], 0x89);
  assert.equal(buf[1], 0x50);
  assert.equal(buf[2], 0x4e);
  assert.equal(buf[3], 0x47);
});

test('ThumbGate og-image PNG exists for link previews', () => {
  assert.equal(fs.existsSync(ogPngPath), true, 'public/og.png must exist');
  const buf = fs.readFileSync(ogPngPath);
  assert.equal(buf[0], 0x89);
  assert.equal(buf[1], 0x50);
  assert.equal(buf[2], 0x4e);
  assert.equal(buf[3], 0x47);
});

test('landing page header uses the /assets/brand SVG mark, not the emoji logo or /brand/', () => {
  const indexHtml = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  // Header logo must reference the /assets/brand SVG mark (served 200 by Railway)
  assert.match(
    indexHtml,
    /<a[^>]*class="nav-logo"[^>]*>\s*<img[^>]*src="\/assets\/brand\/thumbgate-mark\.svg"/,
  );
  assert.match(indexHtml, /<span class="logo-text">ThumbGate<\/span>/);
  // Favicon link tag points at the PNG that actually resolves (not /favicon.svg which 401s)
  assert.match(indexHtml, /<link rel="icon"[^>]*href="\/thumbgate-icon\.png"/);
  // Emoji must no longer appear inside the nav-logo anchor
  assert.doesNotMatch(indexHtml, /class="nav-logo"[^>]*>\s*<span>👍👎<\/span>/);
  // The legacy /brand/ asset path must not be referenced anywhere — it returns 401 on Railway
  assert.doesNotMatch(
    indexHtml,
    /src="\/brand\/thumbgate-mark\.svg"/,
    'legacy /brand/thumbgate-mark.svg path returns 401 on Railway; use /assets/brand/',
  );
});

test('dashboard, lessons, pro, and learn pages use the /assets/brand SVG mark in their header', () => {
  const files = [
    'public/dashboard.html',
    'public/lessons.html',
    'public/pro.html',
    'public/learn.html',
    'public/learn/agent-harness-pattern.html',
    'public/learn/mcp-pre-action-gates-explained.html',
    'public/learn/ai-agent-persistent-memory.html',
    'public/learn/vibe-coding-safety-net.html',
    'public/learn/stop-ai-agent-force-push.html',
  ];
  for (const relPath of files) {
    const html = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
    assert.match(
      html,
      /src="\/assets\/brand\/thumbgate-mark\.svg"/,
      `${relPath} header must reference /assets/brand/thumbgate-mark.svg`,
    );
    assert.doesNotMatch(
      html,
      /src="\/brand\/thumbgate-mark\.svg"/,
      `${relPath} must not use legacy /brand/ path (returns 401)`,
    );
    assert.doesNotMatch(
      html,
      /class="(?:nav-logo|brand)"[^>]*>[^<]*👍👎/,
      `${relPath} header must not render the raw 👍👎 emoji logo`,
    );
  }
});

test('checkout success (Context Gateway Activated) page renders the /assets/brand header', () => {
  const server = fs.readFileSync(path.join(repoRoot, 'src', 'api', 'server.js'), 'utf8');
  // The renderCheckoutSuccessPage body includes a brand-header anchor with the SVG mark
  assert.match(
    server,
    /class="brand-header"[^>]*>\s*<img[^>]*src="\/assets\/brand\/thumbgate-mark\.svg"/,
  );
  // The legacy /brand/ path must not be referenced — it 401s on Railway
  assert.doesNotMatch(server, /src="\/brand\/thumbgate-mark\.svg"/);
  // The legacy emoji logo must no longer be served from server.js nav template
  assert.doesNotMatch(server, /class="nav-logo">👍👎/);
});

test('SEO-GSD generated page template references the /assets/brand SVG mark, not the emoji logo', () => {
  const seoGsd = fs.readFileSync(path.join(repoRoot, 'scripts', 'seo-gsd.js'), 'utf8');
  assert.match(seoGsd, /class="brand"[^>]*>\s*<img[^>]*src="\/assets\/brand\/thumbgate-mark\.svg"/);
  assert.doesNotMatch(seoGsd, /src="\/brand\/thumbgate-mark\.svg"/);
  assert.doesNotMatch(seoGsd, /class="brand"[^>]*>👍👎 ThumbGate/);
});
