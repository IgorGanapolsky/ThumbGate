const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const markPath = path.join(repoRoot, 'public', 'brand', 'thumbgate-mark.svg');
const faviconPath = path.join(repoRoot, 'public', 'favicon.svg');
const ogPath = path.join(repoRoot, 'public', 'brand', 'thumbgate-og.svg');

test('ThumbGate brand mark SVG exists and is a valid viewBox-defined vector', () => {
  assert.equal(fs.existsSync(markPath), true, 'public/brand/thumbgate-mark.svg must exist');
  const svg = fs.readFileSync(markPath, 'utf8');
  assert.match(svg, /<svg/);
  assert.match(svg, /viewBox="0 0 64 64"/);
  assert.match(svg, /fill=/);
  // Brand palette: dark navy tile + teal mark
  assert.match(svg, /#0a1929/i);
  assert.match(svg, /#40e0d0/i);
  assert.match(svg, /<\/svg>/);
});

test('ThumbGate favicon SVG exists for crisp tab and bookmark rendering', () => {
  assert.equal(fs.existsSync(faviconPath), true, 'public/favicon.svg must exist');
  const svg = fs.readFileSync(faviconPath, 'utf8');
  assert.match(svg, /<svg/);
  assert.match(svg, /viewBox/);
});

test('ThumbGate og-image SVG includes mark and wordmark for link previews', () => {
  assert.equal(fs.existsSync(ogPath), true, 'public/brand/thumbgate-og.svg must exist');
  const svg = fs.readFileSync(ogPath, 'utf8');
  assert.match(svg, /viewBox="0 0 1200 630"/);
  assert.match(svg, /ThumbGate/);
});

test('landing page header uses the SVG brand mark, not the emoji logo', () => {
  const indexHtml = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  // Header logo must reference the SVG mark
  assert.match(indexHtml, /<a[^>]*class="nav-logo"[^>]*>\s*<img[^>]*src="\/brand\/thumbgate-mark\.svg"/);
  assert.match(indexHtml, /<span class="logo-text">ThumbGate<\/span>/);
  // Favicon link tag
  assert.match(indexHtml, /<link rel="icon"[^>]*href="\/favicon\.svg"/);
  // Emoji must no longer appear inside the nav-logo anchor
  assert.doesNotMatch(indexHtml, /class="nav-logo"[^>]*>\s*<span>👍👎<\/span>/);
});

test('dashboard, lessons, pro, and learn pages use the SVG brand mark in their header', () => {
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
      /src="\/brand\/thumbgate-mark\.svg"/,
      `${relPath} header must reference /brand/thumbgate-mark.svg`
    );
    assert.doesNotMatch(
      html,
      /class="(?:nav-logo|brand)"[^>]*>[^<]*👍👎/,
      `${relPath} header must not render the raw 👍👎 emoji logo`
    );
  }
});

test('checkout success (Context Gateway Activated) page renders the brand header', () => {
  const server = fs.readFileSync(path.join(repoRoot, 'src', 'api', 'server.js'), 'utf8');
  // The renderCheckoutSuccessPage body includes a brand-header anchor with the SVG mark
  assert.match(server, /class="brand-header"[^>]*>\s*<img[^>]*src="\/brand\/thumbgate-mark\.svg"/);
  // The legacy emoji logo must no longer be served from server.js nav template
  assert.doesNotMatch(server, /class="nav-logo">👍👎/);
});

test('SEO-GSD generated page template references the SVG mark, not the emoji logo', () => {
  const seoGsd = fs.readFileSync(path.join(repoRoot, 'scripts', 'seo-gsd.js'), 'utf8');
  assert.match(seoGsd, /class="brand"[^>]*>\s*<img[^>]*src="\/brand\/thumbgate-mark\.svg"/);
  assert.doesNotMatch(seoGsd, /class="brand"[^>]*>👍👎 ThumbGate/);
});
