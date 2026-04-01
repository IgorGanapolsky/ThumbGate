const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// --- Paths ---
const learnHubPath = path.join(__dirname, '..', 'public', 'learn.html');
const learnDir = path.join(__dirname, '..', 'public', 'learn');
const landingPath = path.join(__dirname, '..', 'public', 'index.html');
const serverPath = path.join(__dirname, '..', 'src', 'api', 'server.js');

function readFile(p) { return fs.readFileSync(p, 'utf8'); }

// ============================================================
// Learn Hub Index (/learn)
// ============================================================

test('learn hub page exists and has correct HTML structure', () => {
  const html = readFile(learnHubPath);
  assert.match(html, /<!DOCTYPE html>/i);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>Learn/);
});

test('learn hub has CollectionPage JSON-LD structured data', () => {
  const html = readFile(learnHubPath);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /"@type":\s*"CollectionPage"/);
});

test('learn hub has canonical URL', () => {
  const html = readFile(learnHubPath);
  assert.match(html, /rel="canonical"/);
  assert.match(html, /\/learn"/);
});

test('learn hub has OG meta tags', () => {
  const html = readFile(learnHubPath);
  assert.match(html, /og:title/);
  assert.match(html, /og:description/);
  assert.match(html, /og:type/);
});

test('learn hub has Plausible analytics', () => {
  const html = readFile(learnHubPath);
  assert.match(html, /data-domain="rlhf-feedback-loop-production\.up\.railway\.app"/);
  assert.match(html, /src="\/js\/analytics\.js"/);
});

test('learn hub links to all three articles', () => {
  const html = readFile(learnHubPath);
  assert.match(html, /\/learn\/stop-ai-agent-force-push/);
  assert.match(html, /\/learn\/vibe-coding-safety-net/);
  assert.match(html, /\/learn\/mcp-pre-action-gates-explained/);
});

test('learn hub has article cards with titles, descriptions, and tags', () => {
  const html = readFile(learnHubPath);
  assert.match(html, /class="article-card"/);
  assert.match(html, /class="article-tag"/);
  assert.match(html, /How to Stop AI Agents From Force-Pushing/);
  assert.match(html, /Vibe Coding Safety Net/);
  assert.match(html, /MCP Pre-Action Gates Explained/);
});

test('learn hub has CTA with npx install command', () => {
  const html = readFile(learnHubPath);
  assert.match(html, /npx mcp-memory-gateway init/);
});

test('learn hub has nav with links to main site and guide', () => {
  const html = readFile(learnHubPath);
  assert.match(html, /href="\/"/);
  assert.match(html, /href="\/guide"/);
  assert.match(html, /href="\/learn"/);
  assert.match(html, /href="\/dashboard"/);
});

// ============================================================
// Article 1: Stop AI Agent Force-Push
// ============================================================

test('force-push article exists with correct structure', () => {
  const html = readFile(path.join(learnDir, 'stop-ai-agent-force-push.html'));
  assert.match(html, /<!DOCTYPE html>/i);
  assert.match(html, /<title>How to Stop AI Agents From Force-Pushing/);
});

test('force-push article has TechArticle JSON-LD', () => {
  const html = readFile(path.join(learnDir, 'stop-ai-agent-force-push.html'));
  assert.match(html, /"@type":\s*"TechArticle"/);
  assert.match(html, /datePublished/);
});

test('force-push article has canonical URL', () => {
  const html = readFile(path.join(learnDir, 'stop-ai-agent-force-push.html'));
  assert.match(html, /rel="canonical"/);
  assert.match(html, /\/learn\/stop-ai-agent-force-push/);
});

test('force-push article has install CTA', () => {
  const html = readFile(path.join(learnDir, 'stop-ai-agent-force-push.html'));
  assert.match(html, /npx mcp-memory-gateway init/);
});

test('force-push article has breadcrumb back to learn hub', () => {
  const html = readFile(path.join(learnDir, 'stop-ai-agent-force-push.html'));
  assert.match(html, /class="breadcrumb"/);
  assert.match(html, /href="\/learn"/);
});

test('force-push article has related links to other articles', () => {
  const html = readFile(path.join(learnDir, 'stop-ai-agent-force-push.html'));
  assert.match(html, /\/learn\/vibe-coding-safety-net/);
  assert.match(html, /\/learn\/mcp-pre-action-gates-explained/);
});

// ============================================================
// Article 2: Vibe Coding Safety Net
// ============================================================

test('vibe-coding article exists with correct structure', () => {
  const html = readFile(path.join(learnDir, 'vibe-coding-safety-net.html'));
  assert.match(html, /<!DOCTYPE html>/i);
  assert.match(html, /<title>The Vibe Coding Safety Net/);
});

test('vibe-coding article has TechArticle JSON-LD', () => {
  const html = readFile(path.join(learnDir, 'vibe-coding-safety-net.html'));
  assert.match(html, /"@type":\s*"TechArticle"/);
});

test('vibe-coding article has comparison grid (with vs without)', () => {
  const html = readFile(path.join(learnDir, 'vibe-coding-safety-net.html'));
  assert.match(html, /class="comparison"/);
  assert.match(html, /Without guardrails/);
  assert.match(html, /With ThumbGate/);
});

test('vibe-coding article has canonical and OG tags', () => {
  const html = readFile(path.join(learnDir, 'vibe-coding-safety-net.html'));
  assert.match(html, /rel="canonical"/);
  assert.match(html, /\/learn\/vibe-coding-safety-net/);
  assert.match(html, /og:title/);
});

test('vibe-coding article has install CTA', () => {
  const html = readFile(path.join(learnDir, 'vibe-coding-safety-net.html'));
  assert.match(html, /npx mcp-memory-gateway init/);
});

test('vibe-coding article has related links', () => {
  const html = readFile(path.join(learnDir, 'vibe-coding-safety-net.html'));
  assert.match(html, /\/learn\/stop-ai-agent-force-push/);
  assert.match(html, /\/learn\/mcp-pre-action-gates-explained/);
});

// ============================================================
// Article 3: MCP Pre-Action Gates Explained
// ============================================================

test('mcp-gates article exists with correct structure', () => {
  const html = readFile(path.join(learnDir, 'mcp-pre-action-gates-explained.html'));
  assert.match(html, /<!DOCTYPE html>/i);
  assert.match(html, /<title>MCP Pre-Action Gates Explained/);
});

test('mcp-gates article has TechArticle JSON-LD', () => {
  const html = readFile(path.join(learnDir, 'mcp-pre-action-gates-explained.html'));
  assert.match(html, /"@type":\s*"TechArticle"/);
});

test('mcp-gates article has comparison table (prompt rules vs gates)', () => {
  const html = readFile(path.join(learnDir, 'mcp-pre-action-gates-explained.html'));
  assert.match(html, /<table>/);
  assert.match(html, /Prompt Rules/);
  assert.match(html, /Pre-Action Gates/);
});

test('mcp-gates article has flow diagram', () => {
  const html = readFile(path.join(learnDir, 'mcp-pre-action-gates-explained.html'));
  assert.match(html, /class="flow-diagram"/);
  assert.match(html, /PreToolUse hook fires/);
});

test('mcp-gates article covers Thompson Sampling', () => {
  const html = readFile(path.join(learnDir, 'mcp-pre-action-gates-explained.html'));
  assert.match(html, /Thompson Sampling/);
});

test('mcp-gates article has canonical and OG tags', () => {
  const html = readFile(path.join(learnDir, 'mcp-pre-action-gates-explained.html'));
  assert.match(html, /rel="canonical"/);
  assert.match(html, /\/learn\/mcp-pre-action-gates-explained/);
  assert.match(html, /og:title/);
});

test('mcp-gates article has install CTA', () => {
  const html = readFile(path.join(learnDir, 'mcp-pre-action-gates-explained.html'));
  assert.match(html, /npx mcp-memory-gateway init/);
});

test('mcp-gates article lists supported agents', () => {
  const html = readFile(path.join(learnDir, 'mcp-pre-action-gates-explained.html'));
  assert.match(html, /Claude Code/);
  assert.match(html, /Cursor/);
  assert.match(html, /Codex/);
  assert.match(html, /Gemini/);
});

// ============================================================
// Integration: Landing page nav includes Learn link
// ============================================================

test('landing page nav includes Learn link', () => {
  const html = readFile(landingPath);
  assert.match(html, /href="\/learn">Learn<\/a>/);
});

// ============================================================
// Integration: Server routes exist for /learn
// ============================================================

test('server.js has LEARN_PAGE_PATH constant', () => {
  const src = readFile(serverPath);
  assert.ok(src.includes('LEARN_PAGE_PATH'), 'LEARN_PAGE_PATH constant missing from server.js');
});

test('server.js has /learn route handler', () => {
  const src = readFile(serverPath);
  assert.ok(src.includes("pathname === '/learn'"), '/learn route missing from server.js');
});

test('server.js has /learn/* article route handler', () => {
  const src = readFile(serverPath);
  assert.ok(src.includes("pathname.startsWith('/learn/')"), '/learn/* route missing from server.js');
});

test('server.js /learn/* route sanitizes slug (no path traversal)', () => {
  const src = readFile(serverPath);
  assert.ok(src.includes('.replace(/[^a-z0-9-]/g'), 'slug sanitization missing — path traversal risk');
  assert.ok(src.includes('.startsWith(LEARN_DIR)'), 'path prefix check missing — path traversal risk');
});

test('server.js API discovery includes /learn endpoint', () => {
  const src = readFile(serverPath);
  assert.ok(src.includes("'/learn'"), '/learn missing from API endpoint discovery');
});

// ============================================================
// Cross-cutting: No stale content or tech debt
// ============================================================

test('all learn articles use consistent nav structure', () => {
  const articles = fs.readdirSync(learnDir).filter(f => f.endsWith('.html'));
  assert.ok(articles.length >= 3, `Expected >= 3 articles, got ${articles.length}`);
  for (const file of articles) {
    const html = readFile(path.join(learnDir, file));
    assert.match(html, /class="brand"/, `${file} missing nav brand`);
    assert.match(html, /href="\/learn"/, `${file} missing learn nav link`);
    assert.match(html, /href="\/guide"/, `${file} missing guide nav link`);
  }
});

test('all learn articles have responsive meta viewport', () => {
  const allFiles = [learnHubPath, ...fs.readdirSync(learnDir).filter(f => f.endsWith('.html')).map(f => path.join(learnDir, f))];
  for (const file of allFiles) {
    const html = readFile(file);
    assert.match(html, /name="viewport"/, `${path.basename(file)} missing viewport meta`);
  }
});

test('no learn page references version numbers (evergreen content)', () => {
  const allFiles = [learnHubPath, ...fs.readdirSync(learnDir).filter(f => f.endsWith('.html')).map(f => path.join(learnDir, f))];
  for (const file of allFiles) {
    const html = readFile(file);
    assert.doesNotMatch(html, /New in v\d/i, `${path.basename(file)} contains stale version reference`);
  }
});

test('no learn page has broken internal links', () => {
  const allFiles = [learnHubPath, ...fs.readdirSync(learnDir).filter(f => f.endsWith('.html')).map(f => path.join(learnDir, f))];
  const validPaths = ['/learn', '/guide', '/dashboard', '/', '/learn/stop-ai-agent-force-push', '/learn/vibe-coding-safety-net', '/learn/mcp-pre-action-gates-explained'];
  for (const file of allFiles) {
    const html = readFile(file);
    const links = html.match(/href="(\/[^"#]*?)"/g) || [];
    for (const link of links) {
      const href = link.match(/href="([^"]+)"/)[1];
      assert.ok(validPaths.includes(href), `${path.basename(file)} has potentially broken link: ${href}`);
    }
  }
});
