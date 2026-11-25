'use strict';

// AGENT-3667, 25 Nov 2026: what Clarity adds on top of PR 5208 (which put the tag on public pages and the Visitor
// behavior tab in /admin): the checkout_click event, no browser-time-zone consent guess, and an owner-console Sources
// tab with one honest tile per source.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const clarity = require('../scripts/clarity');
const CLARITY_ID = 'zjaflwztgq';
const OTHER_SITE_ID = ['zjac22a5n1'].join('');

function injectedTag() {
  const html = clarity.injectClarityTag('<html><head></head><body><a href="/checkout/pro">Pro</a></body></html>', { pathname: '/', headers: {}, env: {} });
  const match = /<script>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match, 'the public home page gets the Clarity tag');
  return { html, source: match[1] };
}

function runTag({ gpc = false, dnt = null, hrefs = [], timeZone = 'America/New_York' } = {}) {
  const { source } = injectedTag();
  const appended = [];
  const calls = [];
  const listeners = {};
  const document = {
    createElement: () => ({}),
    getElementsByTagName: () => [{ parentNode: { insertBefore: (node) => appended.push(node) } }],
    addEventListener: (name, fn) => { listeners[name] = fn; },
  };
  const window = { document, doNotTrack: null };
  window.window = window;
  const navigator = { globalPrivacyControl: gpc, doNotTrack: dnt };
  const Intl = { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone }) }) };
  const context = vm.createContext({ window, document, navigator, Intl });
  vm.runInContext(source, context);
  if (typeof window.clarity === 'function') {
    // The queue is replaced by a recorder after the snippet ran; calls made before this are in window.clarity.q.
    for (const queued of (window.clarity.q || [])) calls.push(Array.from(queued));
    window.clarity = (...args) => { calls.push(args); };
  }
  let stopped = false;
  for (const href of hrefs) {
    const anchor = { nodeType: 1, tagName: 'A', parentNode: null, getAttribute: () => href };
    listeners.click?.({ target: { nodeType: 1, tagName: 'SPAN', parentNode: anchor, getAttribute: () => null }, preventDefault() { stopped = true; } });
  }
  return { appended, calls, listeners, preventedNavigation: stopped };
}

test('REQ-01: no second Clarity loader, and the other site\'s project id appears nowhere', () => {
  assert.equal(fs.existsSync(path.join(PUBLIC, 'js', 'clarity.js')), false, 'the server-injected tag is the only loader');
  const pages = [];
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full); continue; }
      if (!/\.(html|js|cjs|mjs|json|md)$/.test(entry.name)) continue;
      const text = fs.readFileSync(full, 'utf8');
      if (text.includes(OTHER_SITE_ID)) hits.push(path.relative(ROOT, full));
      if (entry.name.endsWith('.html') && /clarity\.ms\/tag/.test(text)) pages.push(path.relative(ROOT, full));
    }
  };
  [PUBLIC, path.join(ROOT, 'scripts'), path.join(ROOT, 'src')].forEach(walk);
  assert.deepEqual(hits, []);
  assert.deepEqual(pages, [], 'no page file carries its own copy of the tag');
});

test('REQ-02: the injected tag loads the ThumbGate project and does not guess consent from the time zone', () => {
  const { html, source } = injectedTag();
  assert.equal((html.match(/www\.clarity\.ms\/tag\//g) || []).length, 1);
  assert.match(html, new RegExp(`"${CLARITY_ID}"`));
  assert.equal(/consentv2|Intl\.DateTimeFormat|timeZone/.test(source), false);
  for (const timeZone of ['America/New_York', 'Europe/Berlin', 'Europe/London', 'Asia/Tokyo']) {
    const run = runTag({ timeZone });
    assert.equal(run.appended.length, 1, timeZone);
    assert.equal(run.calls.some((c) => c[0] === 'consentv2' || c[0] === 'consent'), false, `${timeZone}: no consent call from this site`);
  }
});

test('REQ-02: a Pro checkout click sends checkout_click and leaves the navigation alone; other links send nothing', () => {
  const run = runTag({ hrefs: ['/checkout/pro', 'https://thumbgate.ai/checkout/pro?x=1', '/pricing', '/checkout/team', 'https://buy.example.com/x'] });
  const events = run.calls.filter((c) => c[0] === 'event');
  assert.deepEqual(events, [['event', 'checkout_click'], ['event', 'checkout_click']]);
  assert.equal(run.preventedNavigation, false);
});

test('REQ-02: the checkout_click handler does not register for Global Privacy Control or Do Not Track', () => {
  for (const options of [{ gpc: true }, { dnt: '1' }]) {
    const run = runTag(options);
    assert.equal(run.appended.length, 0);
    assert.equal(run.listeners.click, undefined);
  }
});

test('REQ-03: the owner console never loads Clarity itself, and the Sources tab is on its menu', () => {
  const admin = fs.readFileSync(path.join(PUBLIC, 'admin.html'), 'utf8');
  assert.equal(/clarity\.ms\/tag|\/js\/clarity\.js|plausible\.io|googletagmanager/i.test(admin), false);
  assert.match(admin, /sources: 'Sources'/);
  assert.match(admin, /'behavior', 'sources', 'observability'/);
  const injected = clarity.injectClarityTag('<html><head></head></html>', { pathname: '/admin', headers: {}, env: {} });
  assert.equal(injected.includes('clarity.ms'), false, 'the server leaves /admin alone');
});

function sourcesFixture({ withTags = true, rows = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-sources-'));
  const feedbackDir = path.join(dir, 'feedback');
  const publicDir = path.join(dir, 'public');
  fs.mkdirSync(feedbackDir, { recursive: true });
  fs.mkdirSync(publicDir, { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'index.html'), withTags
    ? '<script defer data-domain="thumbgate.ai" src="https://plausible.io/js/script.js"></script>__GA_BOOTSTRAP__'
    : '<html></html>');
  fs.writeFileSync(path.join(feedbackDir, 'telemetry-pings.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
  return { dir, feedbackDir, publicDir };
}

test('REQ-03: an empty log gives "no data yet" tiles with no count, never a zero', async () => {
  const { collectSources } = require('../scripts/owner-admin');
  const f = sourcesFixture();
  try {
    const result = await collectSources({ feedbackDir: f.feedbackDir, publicDir: f.publicDir, env: { THUMBGATE_GA_MEASUREMENT_ID: 'G-ABCDEF1234' } });
    const tiles = Object.fromEntries(result.data.tiles.map((tile) => [tile.id, tile]));
    for (const id of ['visitor', 'install', 'first_block', 'pro_checkout_click']) {
      assert.equal(tiles[id].status, 'no_data_yet', id);
      assert.equal(tiles[id].lastEventAt, null, id);
      assert.equal(tiles[id].count30d, null, id);
    }
    assert.equal(tiles.plausible.status, 'not_read_here');
    assert.equal(tiles.google_analytics.status, 'not_read_here');
    assert.match(tiles.google_analytics.note, /G-ABCDEF1234/);
    assert.equal(tiles.clarity.status, 'not_read_here');
    assert.equal(tiles.clarity.dashboardUrl, `https://clarity.microsoft.com/projects/view/${CLARITY_ID}/gettingstarted`);
    assert.ok(result.data.tiles.every((tile) => tile.lastEventAt === null));
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('REQ-03: real events show their last time; bot, internal and owner rows are left out; missing tags say not installed', async () => {
  const { collectSources } = require('../scripts/owner-admin');
  const now = Date.now();
  const iso = (minutesAgo) => new Date(now - minutesAgo * 60000).toISOString();
  const f = sourcesFixture({
    withTags: false,
    rows: [
      { eventType: 'landing_page_view', receivedAt: iso(300), clientType: 'web' },
      { eventType: 'landing_page_view', receivedAt: iso(30), clientType: 'web' },
      { eventType: 'landing_page_view', receivedAt: iso(5), clientType: 'web', isBotTraffic: true },
      { eventType: 'cli_init', receivedAt: iso(60), clientType: 'cli', visitorType: 'real_user' },
      { eventType: 'cli_init', receivedAt: iso(2), clientType: 'cli', visitorType: 'owner' },
      { eventType: 'checkout_start', receivedAt: iso(45), clientType: 'web' },
      { eventType: 'pro_checkout_start', receivedAt: iso(20), clientType: 'web' },
    ],
  });
  try {
    const result = await collectSources({ feedbackDir: f.feedbackDir, publicDir: f.publicDir, env: { THUMBGATE_CLARITY_PROJECT_ID: 'off' } });
    const tiles = Object.fromEntries(result.data.tiles.map((tile) => [tile.id, tile]));
    assert.equal(tiles.visitor.status, 'ok');
    assert.equal(tiles.visitor.count30d, 2);
    assert.equal(Date.parse(tiles.visitor.lastEventAt), Date.parse(iso(30)));
    assert.equal(tiles.install.count30d, 1, 'the owner install is not counted');
    assert.equal(Date.parse(tiles.install.lastEventAt), Date.parse(iso(60)));
    assert.equal(tiles.pro_checkout_click.count30d, 2, 'both checkout_start and the /pro page pro_checkout_start count');
    assert.equal(Date.parse(tiles.pro_checkout_click.lastEventAt), Date.parse(iso(20)));
    assert.equal(tiles.first_block.status, 'no_data_yet');
    for (const id of ['plausible', 'google_analytics', 'clarity']) assert.equal(tiles[id].status, 'not_installed', id);
    assert.equal(/api[_-]?key|token|secret/i.test(JSON.stringify(result)), false, 'no credential field in the payload');
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('REQ-02: a page with no Pro checkout link gets the tag without the checkout_click handler', () => {
  const html = clarity.injectClarityTag('<html><head></head><body><form action="/v1/intake/x"></form></body></html>', { pathname: '/partner-intake', headers: {}, env: {} });
  assert.match(html, /www\.clarity\.ms\/tag\//);
  assert.equal(/checkout/i.test(html), false);
});
