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

test('GET /media/thumbgate-demo.gif serves the animated demo GIF without an API key', async () => {
  const res = await fetch(`${origin}/media/thumbgate-demo.gif`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/gif');
  assert.ok(Number(res.headers.get('content-length')) > 0);
});

test('GET /media/does-not-exist.gif returns 404', async () => {
  const res = await fetch(`${origin}/media/does-not-exist.gif`);
  assert.equal(res.status, 404);
});

test('GET /media/../server.js is rejected (no path traversal)', async () => {
  const res = await fetch(`${origin}/media/..%2fapi%2fserver.js`);
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
  assert.match(html, /Enterprise checkout happens after scope\./);
});

test('landing pricing section compares plan capabilities and limits clearly', async () => {
  const res = await fetch(`${origin}/`);
  assert.equal(res.status, 200);
  const html = await res.text();

  assert.match(html, /Compare plans at a glance/);
  assert.match(html, /2\/day, 10 total/);
  assert.match(html, /3 active rules/);
  assert.match(html, /\$19\/mo or \$149\/yr/);
  assert.match(html, /Custom — scoped after intake/);
  assert.match(html, /Enterprise plans start through intake/);
});

test('landing page answers governance objections instead of presenting passive logs', async () => {
  const res = await fetch(`${origin}/`);
  assert.equal(res.status, 200);
  const html = await res.text();

  assert.match(html, /Governance, Not Logging/);
  assert.match(html, /Logs describe the damage\. ThumbGate blocks the risky action before it runs\./);
  assert.match(html, /pre-action decision/);
  assert.match(html, /Reviewable decision trail/);
  assert.match(html, /signed evidence bundles/);
  assert.doesNotMatch(html, /Org Dashboard \(Team\)/);
});

test('homepage and pricing surfaces expose canonical and LLM context links', async () => {
  const pages = [
    ['/', `${origin}/`, `${origin}/llm-context.md`],
    ['/pricing', `${origin}/pricing`, `${origin}/llm-context.md`],
    ['/pro', `${origin}/pro`, `${origin}/llm-context.md`],
    ['/diagnostic', `${origin}/diagnostic`, `${origin}/llm-context.md`],
  ];

  for (const [pathname, canonicalUrl, contextUrl] of pages) {
    const res = await fetch(`${origin}${pathname}`);
    assert.equal(res.status, 200, `${pathname} should render`);
    const html = await res.text();
    assert.match(html, new RegExp(`<link rel="canonical" href="${canonicalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    assert.match(html, new RegExp(`<link rel="alternate" type="text/markdown" title="ThumbGate LLM context" href="${contextUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  }
});

test('GET /diagnostic serves the Workflow Hardening Diagnostic intake page', async () => {
  const res = await fetch(`${origin}/diagnostic`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
  const html = await res.text();
  assert.match(html, /Workflow Hardening Diagnostic/);
  assert.match(html, /Submit for diagnostic scope/);
  assert.match(html, /action="\/v1\/intake\/workflow-sprint"/);
  assert.match(html, /data-diagnostic-intake-form/);
  assert.match(html, /diagnostic_page_submit/);
  assert.match(html, /Pay \$499 diagnostic/);
  assert.match(html, /\/go\/diagnostic\?utm_source=diagnostic_page&amp;utm_medium=onsite&amp;utm_campaign=workflow_hardening_diagnostic/);
  assert.match(html, /data-cta-id="diagnostic_hero_paid"/);
  assert.doesNotMatch(html, /No cold payment link/);
});

test('workflow diagnostic aliases serve the focused diagnostic page', async () => {
  const paths = [
    '/diagnostic.html',
    '/workflow-diagnostic',
    '/workflow-diagnostic.html',
    '/sprint',
    '/sprint.html',
    '/workflow-hardening',
    '/workflow-hardening.html',
    '/workflow-hardening-sprint',
    '/workflow-hardening-sprint.html',
    '/workflow-sprint',
    '/workflow-sprint.html',
  ];

  for (const pathname of paths) {
    const res = await fetch(`${origin}${pathname}`, { redirect: 'manual' });
    assert.equal(res.status, 200, `${pathname} should render diagnostic page`);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    const html = await res.text();
    assert.match(html, /Workflow Hardening Diagnostic/);
    assert.match(html, /Submit for diagnostic scope/);
    assert.match(html, /<link rel="canonical" href="[^"]+\/diagnostic"/);
  }
});

test('GET /sitemap.xml includes /diagnostic and /workflow-hardening-sprint at priority 0.9', async () => {
  const res = await fetch(`${origin}/sitemap.xml`);
  assert.equal(res.status, 200);
  const xml = await res.text();
  for (const route of ['/diagnostic', '/workflow-hardening-sprint']) {
    assert.match(xml, new RegExp(`<loc>[^<]*${route}<\\/loc>`), `sitemap must list ${route}`);
    const entry = xml.match(new RegExp(`<url>\\s*<loc>[^<]*${route}<\\/loc>[\\s\\S]*?<\\/url>`));
    assert.ok(entry, `${route} <url> block must exist`);
    assert.match(entry[0], /<priority>0\.9<\/priority>/);
  }
});

test('LLM discovery file is available at root and well-known paths with canonical thumbgate.ai URLs', async () => {
  const [rootRes, wellKnownRes] = await Promise.all([
    fetch(`${origin}/llms.txt`),
    fetch(`${origin}/.well-known/llms.txt`),
  ]);

  for (const res of [rootRes, wellKnownRes]) {
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/plain/);
    const body = await res.text();
    assert.match(body, /^# ThumbGate/m);
    assert.match(body, /https:\/\/thumbgate\.ai\/llm-context\.md/);
    assert.match(body, /https:\/\/thumbgate\.ai\/pricing/);
    assert.doesNotMatch(body, /thumbgate-production\.up\.railway\.app/);
    assert.doesNotMatch(body, /\/public\/llm-context\.md/);
  }
});

test('Agentic.ai domain verification file is publicly accessible without auth', async () => {
  const res = await fetch(`${origin}/.well-known/agentic-verify.txt`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/plain/);
  assert.equal(
    (await res.text()).trim(),
    '3588d0ad8f7b89fd7b9fbf771c1dd7dd09310e88aa6a7ae049b1decfa971650b',
  );
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
    '/chatgpt-app.html',
    '/chatgpt-plugin.html',
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

test('GET /chatgpt-app serves the ChatGPT app and GPT Action landing HTML', async () => {
  const [routeRes, htmlRes, legacyAliasRes] = await Promise.all([
    fetch(`${origin}/chatgpt-app`),
    fetch(`${origin}/chatgpt-app.html`),
    fetch(`${origin}/chatgpt-plugin`),
  ]);

  for (const res of [routeRes, htmlRes, legacyAliasRes]) {
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    const body = await res.text();
    assert.match(body, /ThumbGate for ChatGPT/);
    assert.match(body, /GPT Action schema/);
    assert.match(body, /Open ThumbGate GPT/);
    assert.match(body, /native thumbs rating buttons are not the ThumbGate memory path/i);
    assert.match(body, /npx thumbgate init --agent codex/);
    assert.match(body, /does not claim official OpenAI marketplace approval/i);
  }
});

test('HEAD /chatgpt-app responds 200 with html content-type and no body', async () => {
  const res = await fetch(`${origin}/chatgpt-app`, { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
  assert.equal(await res.text(), '');
});

test('public marketing directory aliases redirect to canonical pages', async () => {
  const cases = [
    ['/lessons/', '/lessons'],
    ['/guides', '/learn'],
    ['/guides/', '/learn'],
    ['/guides.html', '/learn'],
    ['/services', '/#workflow-sprint-intake'],
    ['/services.html', '/#workflow-sprint-intake'],
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

test('GET /sitemap.xml includes /chatgpt-app at priority 0.85', async () => {
  const res = await fetch(`${origin}/sitemap.xml`);
  assert.equal(res.status, 200);
  const xml = await res.text();
  assert.match(xml, /<loc>[^<]*\/chatgpt-app<\/loc>/, 'sitemap must list /chatgpt-app');
  const entry = xml.match(/<url>\s*<loc>[^<]*\/chatgpt-app<\/loc>[\s\S]*?<\/url>/);
  assert.ok(entry, 'chatgpt-app <url> block must exist');
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

test('GET /ai-malpractice-prevention serves the legal-vertical landing HTML', async () => {
  const [routeRes, htmlRes] = await Promise.all([
    fetch(`${origin}/ai-malpractice-prevention`),
    fetch(`${origin}/ai-malpractice-prevention.html`),
  ]);
  for (const res of [routeRes, htmlRes]) {
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    const body = await res.text();
    assert.ok(body.length > 500, 'ai-malpractice-prevention page must render non-empty HTML');
    // Lock in the legal-specific framing — these are the buyer-vocabulary
    // anchors that distinguish this page from generic AI-safety positioning.
    assert.match(body, /unauthorized practice of law|UPL/i);
    assert.match(body, /privilege/i);
    assert.match(body, /conflict/i);
    assert.match(body, /ABA Formal Op/i);
    assert.match(body, /Pre-execution controls for legal AI agents/i);
    assert.match(body, /Book a 25-minute pilot walkthrough/i);
    assert.match(body, /preloaded ground truth/i);
    assert.match(body, /Local-first enforcement option/i);
    assert.match(body, /No guaranteed-malpractice-prevention claim/i);
  }
});

test('HEAD /ai-malpractice-prevention responds 200 with html content-type', async () => {
  const res = await fetch(`${origin}/ai-malpractice-prevention`, { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
});

test('GET /sitemap.xml includes /ai-malpractice-prevention at priority 0.9', async () => {
  const res = await fetch(`${origin}/sitemap.xml`);
  assert.equal(res.status, 200);
  const xml = await res.text();
  const entry = xml.match(/<url>\s*<loc>[^<]*\/ai-malpractice-prevention<\/loc>[\s\S]*?<\/url>/);
  assert.ok(entry, 'ai-malpractice-prevention <url> block must exist');
  // Priority 0.9 (higher than 0.85 sibling pages) — this is our highest-value
  // single landing surface because the legal-vertical TAM is large and the
  // pages where the FAQ engages partners directly are gold for SEO.
  assert.match(entry[0], /<priority>0\.9<\/priority>/);
});

test('GET /sitemap.xml includes background-agent control layer at priority 0.85', async () => {
  const res = await fetch(`${origin}/sitemap.xml`);
  assert.equal(res.status, 200);
  const xml = await res.text();
  const entry = xml.match(/<url>\s*<loc>[^<]*\/learn\/background-agent-control-layer<\/loc>[\s\S]*?<\/url>/);
  assert.ok(entry, 'background-agent-control-layer <url> block must exist');
  assert.match(entry[0], /<priority>0\.85<\/priority>/);
});

test('GET /sitemap.xml includes enterprise and deterministic workflow learning pages', async () => {
  const res = await fetch(`${origin}/sitemap.xml`);
  assert.equal(res.status, 200);
  const xml = await res.text();
  for (const slug of [
    'agentic-enterprise-context-brain',
    'deterministic-agent-workflows',
  ]) {
    const entry = xml.match(new RegExp(`<url>\\s*<loc>[^<]*/learn/${slug}</loc>[\\s\\S]*?</url>`));
    assert.ok(entry, `${slug} <url> block must exist`);
    assert.match(entry[0], /<priority>0\.85<\/priority>/);
  }
});

test('GET /compare/claude-code-hooks serves the hand-written comparison page', async () => {
  const res = await fetch(`${origin}/compare/claude-code-hooks`);
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/html/);
  const html = await res.text();
  // Title + canonical positioning
  assert.match(html, /ThumbGate vs claude-code-hooks/);
  assert.match(html, /Hosted Sync vs Local Shell Scripts/);
  // FAQ schema + structured data must be present for LLM citation
  assert.match(html, /"@type":\s*"FAQPage"/);
  assert.match(html, /"@type":\s*"TechArticle"/);
  // Honest framing — must link to karanb192's repo
  assert.match(html, /github\.com\/karanb192\/claude-code-hooks/);
  // Comparison table must surface the key differentiation rows
  assert.match(html, /Agents supported/);
  assert.match(html, /Cross-machine sync/);
  assert.match(html, /Adapter maintenance/);
});

test('GET /sitemap.xml includes the claude-code-hooks comparison page', async () => {
  const res = await fetch(`${origin}/sitemap.xml`);
  assert.equal(res.status, 200);
  const xml = await res.text();
  const entry = xml.match(/<url>\s*<loc>[^<]*\/compare\/claude-code-hooks<\/loc>[\s\S]*?<\/url>/);
  assert.ok(entry, 'compare/claude-code-hooks <url> block must exist');
  assert.match(entry[0], /<priority>0\.85<\/priority>/);
});

test('GET /compare/bumblebee serves the hand-written comparison page', async () => {
  const res = await fetch(`${origin}/compare/bumblebee`);
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/html/);
  const html = await res.text();
  // Title + canonical positioning
  assert.match(html, /ThumbGate vs Bumblebee/);
  assert.match(html, /Runtime Enforcement Pairs With Static Inventory/);
  // FAQ + TechArticle schema must be present for LLM citation
  assert.match(html, /"@type":\s*"FAQPage"/);
  assert.match(html, /"@type":\s*"TechArticle"/);
  // Honest framing — must link to Perplexity's repo
  assert.match(html, /github\.com\/perplexityai\/bumblebee/);
  // Comparison table must surface the key rows
  assert.match(html, /What it does/);
  assert.match(html, /What it blocks/);
  assert.match(html, /Output format/);
});

test('GET /sitemap.xml includes the bumblebee comparison page', async () => {
  const res = await fetch(`${origin}/sitemap.xml`);
  assert.equal(res.status, 200);
  const xml = await res.text();
  const entry = xml.match(/<url>\s*<loc>[^<]*\/compare\/bumblebee<\/loc>[\s\S]*?<\/url>/);
  assert.ok(entry, 'compare/bumblebee <url> block must exist');
  assert.match(entry[0], /<priority>0\.85<\/priority>/);
});

test('GET /compare/anthropic-containment serves the hand-written comparison page', async () => {
  const res = await fetch(`${origin}/compare/anthropic-containment`);
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/html/);
  const html = await res.text();
  // Title + positioning
  assert.match(html, /ThumbGate vs Anthropic's Claude Containment/);
  assert.match(html, /IDE-Agent Extension/);
  // FAQ + TechArticle schema for LLM citation
  assert.match(html, /"@type":\s*"FAQPage"/);
  assert.match(html, /"@type":\s*"TechArticle"/);
  // Honest framing — must cite Anthropic's actual article URL
  assert.match(html, /anthropic\.com\/engineering\/how-we-contain-claude/);
  // The three lessons that anchor the page
  assert.match(html, /Tool output is an attack surface/);
  assert.match(html, /software you build yourself is often the weakest/);
});

test('GET /sitemap.xml includes the anthropic-containment comparison page', async () => {
  const res = await fetch(`${origin}/sitemap.xml`);
  assert.equal(res.status, 200);
  const xml = await res.text();
  const entry = xml.match(/<url>\s*<loc>[^<]*\/compare\/anthropic-containment<\/loc>[\s\S]*?<\/url>/);
  assert.ok(entry, 'compare/anthropic-containment <url> block must exist');
  assert.match(entry[0], /<priority>0\.85<\/priority>/);
});

test('comparison pages cross-link so crawlers can discover the full set', async () => {
  // Discovery surface: every recent /compare page should link to the other recent ones,
  // so a crawler that lands on any single page can reach the others without sitemap.
  const [bb, cch] = await Promise.all([
    fetch(`${origin}/compare/bumblebee`).then((r) => r.text()),
    fetch(`${origin}/compare/claude-code-hooks`).then((r) => r.text()),
  ]);
  // /compare/bumblebee must link to anthropic-containment
  assert.match(bb, /href="\/compare\/anthropic-containment"/);
  // /compare/claude-code-hooks must link to both newer pages
  assert.match(cch, /href="\/compare\/anthropic-containment"/);
  assert.match(cch, /href="\/compare\/bumblebee"/);
});

test('GET /compare/oak-and-sparrow-gatekeeper serves the hand-written comparison page', async () => {
  const res = await fetch(`${origin}/compare/oak-and-sparrow-gatekeeper`);
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/html/);
  const html = await res.text();
  // Title + positioning
  assert.match(html, /ThumbGate vs Gatekeeper/);
  assert.match(html, /Agent-Action Gate Pairs With Workforce-Input Gate/);
  // FAQ + TechArticle schema for LLM citation
  assert.match(html, /"@type":\s*"FAQPage"/);
  assert.match(html, /"@type":\s*"TechArticle"/);
  // Honest framing — must link to Oak & Sparrow's actual site
  assert.match(html, /oakandsparrowsystemsenterprise\.io/);
  // The shared-architecture frame that anchors the page
  assert.match(html, /deterministic enforcement/);
});

test('GET /sitemap.xml includes the oak-and-sparrow-gatekeeper comparison page', async () => {
  const res = await fetch(`${origin}/sitemap.xml`);
  assert.equal(res.status, 200);
  const xml = await res.text();
  const entry = xml.match(/<url>\s*<loc>[^<]*\/compare\/oak-and-sparrow-gatekeeper<\/loc>[\s\S]*?<\/url>/);
  assert.ok(entry, 'compare/oak-and-sparrow-gatekeeper <url> block must exist');
  assert.match(entry[0], /<priority>0\.85<\/priority>/);
});

test('comparison pages link back to oak-and-sparrow-gatekeeper for discovery', async () => {
  // Every recently-shipped /compare page must back-link to the newest one so a crawler
  // landing on bumblebee / claude-code-hooks / anthropic-containment can reach it.
  const [bb, cch, ant] = await Promise.all([
    fetch(`${origin}/compare/bumblebee`).then((r) => r.text()),
    fetch(`${origin}/compare/claude-code-hooks`).then((r) => r.text()),
    fetch(`${origin}/compare/anthropic-containment`).then((r) => r.text()),
  ]);
  assert.match(bb, /href="\/compare\/oak-and-sparrow-gatekeeper"/);
  assert.match(cch, /href="\/compare\/oak-and-sparrow-gatekeeper"/);
  assert.match(ant, /href="\/compare\/oak-and-sparrow-gatekeeper"/);
});

test('GET /learn/ac-dc-runtime-enforcement serves the hand-written learn page', async () => {
  const res = await fetch(`${origin}/learn/ac-dc-runtime-enforcement`);
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/html/);
  const html = await res.text();
  // Title + positioning
  assert.match(html, /AC\/DC governs the code agents write/);
  assert.match(html, /Runtime enforcement governs what agents do/);
  // FAQ + TechArticle schema for LLM citation
  assert.match(html, /"@type":\s*"FAQPage"/);
  assert.match(html, /"@type":\s*"TechArticle"/);
  // Honest framing — must cite Sonar's article + The New Stack
  assert.match(html, /sonarsource\.com\/blog\/the-future-is-ac-dc/);
  assert.match(html, /thenewstack\.io\/agentic-development-cycle-framework/);
  // The structural-gap claim that anchors the page
  assert.match(html, /Pre-Execution Gate/);
  assert.match(html, /PreToolUse/);
});

test('GET /sitemap.xml includes /learn/ac-dc-runtime-enforcement at priority 0.85', async () => {
  const res = await fetch(`${origin}/sitemap.xml`);
  assert.equal(res.status, 200);
  const xml = await res.text();
  const entry = xml.match(/<url>\s*<loc>[^<]*\/learn\/ac-dc-runtime-enforcement<\/loc>[\s\S]*?<\/url>/);
  assert.ok(entry, 'ac-dc-runtime-enforcement <url> block must exist');
  assert.match(entry[0], /<priority>0\.85<\/priority>/);
});

test('background-agent-control-layer links to ac-dc-runtime-enforcement for discovery', async () => {
  // Discovery surface: the most-trafficked /learn page should reach the newest one.
  const html = await fetch(`${origin}/learn/background-agent-control-layer`).then((r) => r.text());
  assert.match(html, /href="\/learn\/ac-dc-runtime-enforcement"/);
});

test('GET /compare/arcjet serves the hand-written comparison page', async () => {
  const res = await fetch(`${origin}/compare/arcjet`);
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/html/);
  const html = await res.text();
  // Title + positioning
  assert.match(html, /ThumbGate vs Arcjet/);
  assert.match(html, /Agent-Outbound Gate Pairs With App-Inbound Firewall/);
  // FAQ + TechArticle schema for LLM citation
  assert.match(html, /"@type":\s*"FAQPage"/);
  assert.match(html, /"@type":\s*"TechArticle"/);
  // Honest framing — must link to Arcjet's actual docs + the TNS Arcjet article we cite
  assert.match(html, /docs\.arcjet\.com/);
  assert.match(html, /thenewstack\.io\/arcjet-wafs-guards-ai-agents-security/);
  // The dual-side framing that anchors the page
  assert.match(html, /inbound/);
  assert.match(html, /outbound/);
});

test('GET /sitemap.xml includes the arcjet comparison page', async () => {
  const res = await fetch(`${origin}/sitemap.xml`);
  assert.equal(res.status, 200);
  const xml = await res.text();
  const entry = xml.match(/<url>\s*<loc>[^<]*\/compare\/arcjet<\/loc>[\s\S]*?<\/url>/);
  assert.ok(entry, 'compare/arcjet <url> block must exist');
  assert.match(entry[0], /<priority>0\.85<\/priority>/);
});

test('comparison pages link back to arcjet for discovery', async () => {
  // Every recently-shipped /compare page must back-link to the newest one so a crawler
  // landing on any one of them can reach the arcjet page.
  const [bb, cch, ant, gk] = await Promise.all([
    fetch(`${origin}/compare/bumblebee`).then((r) => r.text()),
    fetch(`${origin}/compare/claude-code-hooks`).then((r) => r.text()),
    fetch(`${origin}/compare/anthropic-containment`).then((r) => r.text()),
    fetch(`${origin}/compare/oak-and-sparrow-gatekeeper`).then((r) => r.text()),
  ]);
  assert.match(bb, /href="\/compare\/arcjet"/);
  assert.match(cch, /href="\/compare\/arcjet"/);
  assert.match(ant, /href="\/compare\/arcjet"/);
  assert.match(gk, /href="\/compare\/arcjet"/);
});

test('GET /ai-malpractice-prevention surfaces the monitor-vs-enforce framing', async () => {
  const res = await fetch(`${origin}/ai-malpractice-prevention`);
  assert.equal(res.status, 200);
  const html = await res.text();
  // The pre-fold callout the demo opens with — pre-empts the "monitoring" frame
  // that's currently dominant in TNS / agent-observability coverage.
  assert.match(html, /Monitor vs enforce/);
  assert.match(html, /runtime block before execution/);
});

test('GET /learn/feedback-loop-vs-decision-layer serves the hand-written learn page', async () => {
  const res = await fetch(`${origin}/learn/feedback-loop-vs-decision-layer`);
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/html/);
  const html = await res.text();
  assert.match(html, /feedback loop is the product/);
  assert.match(html, /PreToolUse hook is its endpoint/);
  assert.match(html, /"@type":\s*"FAQPage"/);
  assert.match(html, /"@type":\s*"TechArticle"/);
  assert.match(html, /Stage 1 &mdash; Capture/);
  assert.match(html, /Stage 2 &mdash; Memory/);
  assert.match(html, /Stage 3 &mdash; Rule promotion/);
  assert.match(html, /Stage 4 &mdash; Enforcement/);
});

test('GET /sitemap.xml includes /learn/feedback-loop-vs-decision-layer at priority 0.9', async () => {
  const res = await fetch(`${origin}/sitemap.xml`);
  assert.equal(res.status, 200);
  const xml = await res.text();
  const entry = xml.match(/<url>\s*<loc>[^<]*\/learn\/feedback-loop-vs-decision-layer<\/loc>[\s\S]*?<\/url>/);
  assert.ok(entry, 'feedback-loop-vs-decision-layer <url> block must exist');
  assert.match(entry[0], /<priority>0\.9<\/priority>/);
});

test('GET /guides/hermes-agent-guardrails serves the Hermes positioning guide and lists it in sitemap', async () => {
  const [guideRes, sitemapRes] = await Promise.all([
    fetch(`${origin}/guides/hermes-agent-guardrails`),
    fetch(`${origin}/sitemap.xml`),
  ]);

  assert.equal(guideRes.status, 200);
  assert.match(String(guideRes.headers.get('content-type')), /text\/html/);
  const html = await guideRes.text();
  assert.match(html, /Hermes Agent Guardrails/);
  assert.match(html, /ThumbGate keeps the growing agent safe/);
  assert.match(html, /persistent memory, generated skills, messaging gateways, scheduled automations, and sandboxed execution/);
  assert.match(html, /Go Pro|Start intake|Pay \$499 diagnostic/);

  assert.equal(sitemapRes.status, 200);
  const sitemap = await sitemapRes.text();
  assert.match(sitemap, /<loc>[^<]*\/guides\/hermes-agent-guardrails<\/loc>/);
});

test('GET /guides/agent-context-governance serves context governance guide and lists it in sitemap', async () => {
  const [guideRes, sitemapRes] = await Promise.all([
    fetch(`${origin}/guides/agent-context-governance`),
    fetch(`${origin}/sitemap.xml`),
  ]);

  assert.equal(guideRes.status, 200);
  assert.match(String(guideRes.headers.get('content-type')), /text\/html/);
  const html = await guideRes.text();
  assert.match(html, /Agent Context Governance/);
  assert.match(html, /More Context Is Not Governance/);
  assert.match(html, /MCP config integrity gate/);
  assert.match(html, /Customer-response draft gate/);
  assert.match(html, /Tool lockdown gate/);
  assert.match(html, /AI-authored code gate/);
  assert.match(html, /Go Pro|Start intake|Pay \$499 diagnostic/);

  assert.equal(sitemapRes.status, 200);
  const sitemap = await sitemapRes.text();
  assert.match(sitemap, /<loc>[^<]*\/guides\/agent-context-governance<\/loc>/);
});

test('background-agent-control-layer links to feedback-loop-vs-decision-layer for discovery', async () => {
  const html = await fetch(`${origin}/learn/background-agent-control-layer`).then((r) => r.text());
  assert.match(html, /href="\/learn\/feedback-loop-vs-decision-layer"/);
});

test('GET /compare/anthropic-claude-for-legal serves the hand-written comparison page', async () => {
  const res = await fetch(`${origin}/compare/anthropic-claude-for-legal`);
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/html/);
  const html = await res.text();
  // Title + positioning
  assert.match(html, /ThumbGate vs Claude for Legal/);
  assert.match(html, /Runtime Gate Pairs With Anthropic's Practice-Area Plugins/);
  // FAQ + TechArticle schema for LLM citation
  assert.match(html, /"@type":\s*"FAQPage"/);
  assert.match(html, /"@type":\s*"TechArticle"/);
  // Honest framing — must cite Anthropic launch sources
  assert.match(html, /artificiallawyer\.com\/2026\/05\/12\/claude-for-legal-launches/);
  // The full feedback-loop framing — NOT PreToolUse-only
  assert.match(html, /full ThumbGate loop/);
  assert.match(html, /Rule promotion/);
});

test('GET /sitemap.xml includes the anthropic-claude-for-legal comparison page', async () => {
  const res = await fetch(`${origin}/sitemap.xml`);
  assert.equal(res.status, 200);
  const xml = await res.text();
  const entry = xml.match(/<url>\s*<loc>[^<]*\/compare\/anthropic-claude-for-legal<\/loc>[\s\S]*?<\/url>/);
  assert.ok(entry, 'compare/anthropic-claude-for-legal <url> block must exist');
  assert.match(entry[0], /<priority>0\.9<\/priority>/);
});

test('comparison pages link back to anthropic-claude-for-legal for discovery', async () => {
  const [bb, cch, ant, gk, arc] = await Promise.all([
    fetch(`${origin}/compare/bumblebee`).then((r) => r.text()),
    fetch(`${origin}/compare/claude-code-hooks`).then((r) => r.text()),
    fetch(`${origin}/compare/anthropic-containment`).then((r) => r.text()),
    fetch(`${origin}/compare/oak-and-sparrow-gatekeeper`).then((r) => r.text()),
    fetch(`${origin}/compare/arcjet`).then((r) => r.text()),
  ]);
  assert.match(bb, /href="\/compare\/anthropic-claude-for-legal"/);
  assert.match(cch, /href="\/compare\/anthropic-claude-for-legal"/);
  assert.match(ant, /href="\/compare\/anthropic-claude-for-legal"/);
  assert.match(gk, /href="\/compare\/anthropic-claude-for-legal"/);
  assert.match(arc, /href="\/compare\/anthropic-claude-for-legal"/);
});

test('/ai-malpractice-prevention surfaces feedback-loop framing + jump-link to live demos in the hero', async () => {
  const res = await fetch(`${origin}/ai-malpractice-prevention`);
  assert.equal(res.status, 200);
  const html = await res.text();
  // The feedback-loop callout (CEO scope correction surfaced in the hero)
  assert.match(html, /The gate learns from your attorneys/);
  assert.match(html, /href="\/learn\/feedback-loop-vs-decision-layer"/);
  // The jump-link to the live gate demos (so Igor doesn't have to scroll through 9 sections mid-demo)
  assert.match(html, /href="#live-gate-demos"[^>]*>Try the live gates/);
});

test('/ai-malpractice-prevention surfaces the GT-aligned predictability bridge', async () => {
  const res = await fetch(`${origin}/ai-malpractice-prevention`);
  assert.equal(res.status, 200);
  const html = await res.text();
  // The bridge paragraph that translates our defensive frame into GT's own three nouns
  // (predictability, insights, value) — the same language GT's public innovation page uses.
  assert.match(html, /Predictability you can put in front of a client/);
  assert.match(html, /Predictability\. Insights\. Value\./);
  assert.match(html, /agentic-AI deployment.*predictable enough to sell/i);
});

test('GET /favicon.ico serves the directory-verification favicon without an API key', async () => {
  const res = await fetch(`${origin}/favicon.ico`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /icon/);
  assert.ok(Number(res.headers.get('content-length')) > 0, 'favicon must be non-zero');
});

test('GET /docs/connectors serves the MCP connector documentation (PRM resource_documentation target)', async () => {
  const res = await fetch(`${origin}/docs/connectors`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
  const body = await res.text();
  assert.match(body, /Remote MCP Connector/, 'must render the connector doc title');
  assert.match(body, /\/mcp/, 'must show the connect URL');
  assert.match(body, /reviewer credential/i, 'must document the read-only reviewer credential');
  assert.match(body, /PKCE/i, 'must describe the OAuth 2.1 PKCE flow');
});

test('GET /docs/connectors/ (trailing slash) also resolves', async () => {
  const res = await fetch(`${origin}/docs/connectors/`);
  assert.equal(res.status, 200);
});

// Regression guard: every hand-written comparison page must appear in the sitemap.
// Root cause this prevents: compare pages were enumerated in a hand-maintained list,
// so new public/compare/*.html files silently fell out of /sitemap.xml and became
// undiscoverable by crawlers and AI answer engines (Google AI Overviews/AI Mode,
// ChatGPT, Perplexity) on their buyer-intent queries. renderSitemapXml now derives
// these from the filesystem; this test pins that contract so it can't drift again.
test('GET /sitemap.xml lists every public/compare/*.html page', async () => {
  const comparePages = fs
    .readdirSync(path.join(publicDir, 'compare'))
    .filter((file) => file.endsWith('.html'))
    .map((file) => `/compare/${file.replace(/\.html$/, '')}`);

  assert.ok(comparePages.length >= 13, `expected the full compare catalog, got ${comparePages.length}`);

  const res = await fetch(`${origin}/sitemap.xml`);
  assert.equal(res.status, 200);
  const xml = await res.text();

  const missing = comparePages.filter(
    (p) => !new RegExp(`<loc>[^<]*${p.replace(/[/-]/g, (c) => `\\${c}`)}</loc>`).test(xml),
  );
  assert.deepEqual(missing, [], `comparison pages missing from sitemap: ${missing.join(', ')}`);
});

// Regression guard: guide pages are AI-search/GEO landing pages, so adding one
// without a sitemap entry makes it effectively invisible to crawlers.
test('GET /sitemap.xml lists every public/guides/*.html page', async () => {
  const guidePages = fs
    .readdirSync(path.join(publicDir, 'guides'))
    .filter((file) => file.endsWith('.html'))
    .map((file) => `/guides/${file.replace(/\.html$/, '')}`);

  assert.ok(guidePages.includes('/guides/vllm-serving-guardrails'), 'expected vLLM guide to be part of the guide catalog');

  const res = await fetch(`${origin}/sitemap.xml`);
  assert.equal(res.status, 200);
  const xml = await res.text();

  const missing = guidePages.filter(
    (p) => !new RegExp(`<loc>[^<]*${p.replace(/[/-]/g, (c) => `\\${c}`)}</loc>`).test(xml),
  );
  assert.deepEqual(missing, [], `guide pages missing from sitemap: ${missing.join(', ')}`);
});

// Root cause this prevents: the /compare hub linked to a hand-maintained subset of the
// catalog (4 of 13 pages), so flagship buyer-intent comparisons (claude-code-hooks, arcjet,
// bumblebee, anthropic-containment, ...) were live and in the sitemap but unreachable from
// the hub whose entire job is to list them — and the homepage strip had the same drift.
// This test pins the contract: the hub must link to every public/compare/*.html page.
test('GET /compare hub links to every public/compare/*.html page', async () => {
  const comparePages = fs
    .readdirSync(path.join(publicDir, 'compare'))
    .filter((file) => file.endsWith('.html'))
    .map((file) => `/compare/${file.replace(/\.html$/, '')}`);

  assert.ok(comparePages.length >= 13, `expected the full compare catalog, got ${comparePages.length}`);

  const res = await fetch(`${origin}/compare`);
  assert.equal(res.status, 200);
  const html = await res.text();

  const missing = comparePages.filter(
    (p) => !new RegExp(`href="${p.replace(/[/-]/g, (c) => `\\${c}`)}"`).test(html),
  );
  assert.deepEqual(missing, [], `comparison pages missing from the /compare hub: ${missing.join(', ')}`);
});

// GEO: comparison and high-intent landing pages carry FAQPage structured data so they
// are eligible to be pulled into AI Overviews / AI Mode on their category queries.
test('comparison and key landing pages expose FAQPage structured data', async () => {
  for (const pagePath of ['/compare/rein', '/agent-manager']) {
    const res = await fetch(`${origin}${pagePath}`);
    assert.equal(res.status, 200, `${pagePath} must serve`);
    const body = await res.text();
    assert.match(body, /"@type":\s*"FAQPage"/, `${pagePath} must declare FAQPage schema`);
    assert.match(body, /"@type":\s*"Question"/, `${pagePath} must include at least one Question`);
  }
});

test('GET /media/thumbgate-demo.gif serves the animated demo GIF without an API key', async () => {
  const res = await fetch(`${origin}/media/thumbgate-demo.gif`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/gif');
  assert.ok(Number(res.headers.get('content-length')) > 0);
});

test('GET /media/does-not-exist.gif returns 404', async () => {
  const res = await fetch(`${origin}/media/does-not-exist.gif`);
  assert.equal(res.status, 404);
});

test('GET /media/../server.js is rejected (no path traversal)', async () => {
  const res = await fetch(`${origin}/media/..%2fapi%2fserver.js`);
  assert.ok([403, 404].includes(res.status));
  assert.notEqual(res.status, 200);
});
