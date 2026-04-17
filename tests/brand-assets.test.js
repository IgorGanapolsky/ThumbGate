const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
// App-icon style mark (full-canvas dark rounded tile) — correct for apple-touch-icon / PWA manifest / OG
const markPath = path.join(repoRoot, 'public', 'assets', 'brand', 'thumbgate-mark.svg');
// Transparent full-bleed mark — correct for site-header inline use next to the wordmark
const inlineMarkPath = path.join(repoRoot, 'public', 'assets', 'brand', 'thumbgate-mark-inline.svg');
const faviconPngPath = path.join(repoRoot, 'public', 'thumbgate-icon.png');
const ogPngPath = path.join(repoRoot, 'public', 'og.png');

test('ThumbGate app-icon mark SVG exists at /assets/brand (for apple-touch-icon / PWA)', () => {
  assert.equal(fs.existsSync(markPath), true, 'public/assets/brand/thumbgate-mark.svg must exist');
  const svg = fs.readFileSync(markPath, 'utf8');
  assert.match(svg, /<svg/);
  assert.match(svg, /viewBox="0 0 \d+ \d+"/);
  assert.match(svg, /fill=/);
  assert.match(svg, /<\/svg>/);
});

test('ThumbGate inline mark SVG exists with transparent backdrop for header use', () => {
  assert.equal(
    fs.existsSync(inlineMarkPath),
    true,
    'public/assets/brand/thumbgate-mark-inline.svg must exist for header use',
  );
  const svg = fs.readFileSync(inlineMarkPath, 'utf8');
  assert.match(svg, /<svg/);
  assert.match(svg, /viewBox="0 0 \d+ \d+"/);
  assert.match(svg, /<\/svg>/);
  // Guard: inline mark must NOT contain a full-canvas opaque rounded-rect tile. That tile
  // backdrop is what made thumbgate-mark.svg render as a tiny iOS-launcher icon inside
  // website headers. The inline variant exists specifically to avoid that look.
  assert.doesNotMatch(
    svg,
    /<rect[^>]*\bwidth="512"[^>]*\bfill="#0a0d12"/,
    'inline mark must be transparent — no full-canvas dark tile backdrop',
  );
  assert.doesNotMatch(
    svg,
    /<rect[^>]*\bfill="#0a0d12"[^>]*\bwidth="512"/,
    'inline mark must be transparent — no full-canvas dark tile backdrop',
  );
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

test('landing page header uses the inline (transparent) mark, not the app-icon tile', () => {
  const indexHtml = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  // Header logo must reference the transparent inline mark — not the app-icon tile,
  // which renders as a tiny iOS-launcher icon when sized down to header proportions.
  assert.match(
    indexHtml,
    /<a[^>]*class="nav-logo"[^>]*>\s*<img[^>]*src="\/assets\/brand\/thumbgate-mark-inline\.svg"/,
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
  // App-icon mark (with full dark tile) must not be inlined in the header — only inline variant.
  assert.doesNotMatch(
    indexHtml,
    /class="nav-logo"[^>]*>\s*<img[^>]*src="\/assets\/brand\/thumbgate-mark\.svg"/,
    'header must use thumbgate-mark-inline.svg; the app-icon thumbgate-mark.svg renders as a tiny tile inline',
  );
});

test('dashboard, lessons, pro, and learn pages use the inline mark in their header', () => {
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
      /src="\/assets\/brand\/thumbgate-mark-inline\.svg"/,
      `${relPath} header must reference /assets/brand/thumbgate-mark-inline.svg`,
    );
    assert.doesNotMatch(
      html,
      /src="\/brand\/thumbgate-mark\.svg"/,
      `${relPath} must not use legacy /brand/ path (returns 401)`,
    );
    // Header <img> must not point at the app-icon tile variant — only the transparent inline variant.
    assert.doesNotMatch(
      html,
      /class="(?:nav-logo|brand|brand-header)"[^>]*>\s*<img[^>]*src="\/assets\/brand\/thumbgate-mark\.svg"/,
      `${relPath} header must use the inline (transparent) mark, not the app-icon tile`,
    );
    assert.doesNotMatch(
      html,
      /class="(?:nav-logo|brand)"[^>]*>[^<]*👍👎/,
      `${relPath} header must not render the raw 👍👎 emoji logo`,
    );
  }
});

test('checkout success (Context Gateway Activated) page renders the inline mark in its header', () => {
  const server = fs.readFileSync(path.join(repoRoot, 'src', 'api', 'server.js'), 'utf8');
  // The renderCheckoutSuccessPage body includes a brand-header anchor with the inline SVG mark.
  assert.match(
    server,
    /class="brand-header"[^>]*>\s*<img[^>]*src="\/assets\/brand\/thumbgate-mark-inline\.svg"/,
  );
  // The legacy /brand/ path must not be referenced — it 401s on Railway
  assert.doesNotMatch(server, /src="\/brand\/thumbgate-mark\.svg"/);
  // The legacy emoji logo must no longer be served from server.js nav template
  assert.doesNotMatch(server, /class="nav-logo">👍👎/);
  // App-icon mark must not be used as the inline header image (that's the iOS-launcher-tile bug)
  assert.doesNotMatch(
    server,
    /class="brand-header"[^>]*>\s*<img[^>]*src="\/assets\/brand\/thumbgate-mark\.svg"/,
    'success page header must use thumbgate-mark-inline.svg, not the app-icon tile variant',
  );
});

test('SEO-GSD generated page template uses the inline mark, not the app-icon tile', () => {
  const seoGsd = fs.readFileSync(path.join(repoRoot, 'scripts', 'seo-gsd.js'), 'utf8');
  assert.match(
    seoGsd,
    /class="brand"[^>]*>\s*<img[^>]*src="\/assets\/brand\/thumbgate-mark-inline\.svg"/,
  );
  assert.doesNotMatch(seoGsd, /src="\/brand\/thumbgate-mark\.svg"/);
  assert.doesNotMatch(seoGsd, /class="brand"[^>]*>👍👎 ThumbGate/);
});
