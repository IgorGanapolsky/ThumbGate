'use strict';

// AGENT-3667, 25 Nov 2026: Microsoft Clarity on the public pages that carry Plausible, and an owner-console Sources tab
// with one honest tile per source. REQ numbers match the brief (item U).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const CLARITY_ID = 'zjaflwztgq';
const OTHER_SITE_ID = ['zjac22a5n1'].join('');
const PRIVATE_PAGES = new Set(['dashboard.html', 'lessons.html', 'onboarding.html', 'admin.html']);

function htmlFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(full));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

test('REQ-01: Clarity loads on every page that carries Plausible, except pages that show private data', () => {
  const missing = [];
  const leaked = [];
  let withPlausible = 0;
  for (const file of htmlFiles(PUBLIC)) {
    const rel = path.relative(PUBLIC, file);
    const text = fs.readFileSync(file, 'utf8');
    const hasPlausible = /plausible\.io\/js\//.test(text);
    const hasClarity = text.includes('/js/clarity.js');
    if (hasPlausible) withPlausible += 1;
    if (hasPlausible && !PRIVATE_PAGES.has(rel) && !hasClarity) missing.push(rel);
    if (PRIVATE_PAGES.has(rel) && (hasClarity || /clarity\.ms/.test(text))) leaked.push(rel);
  }
  assert.ok(withPlausible > 50, 'the page scan found the Plausible pages');
  assert.deepEqual(missing, []);
  assert.deepEqual(leaked, [], 'no Clarity on the owner console, dashboard, lessons or onboarding');
});

test('REQ-01: the other site\'s Clarity project id appears nowhere in the shipped site or server code', () => {
  const hits = [];
  const roots = [PUBLIC, path.join(ROOT, 'scripts'), path.join(ROOT, 'src')];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(html|js|cjs|mjs|json|md)$/.test(entry.name) && fs.readFileSync(full, 'utf8').includes(OTHER_SITE_ID)) hits.push(path.relative(ROOT, full));
    }
  };
  roots.forEach(walk);
  assert.deepEqual(hits, []);
});

function runLoader({ pathname = '/', gpc = false, dnt = null, links = [] } = {}) {
  const appended = [];
  const clarityEvents = [];
  const listeners = {};
  const fields = [{ setAttribute(name, value) { this[name] = value; } }, { setAttribute(name, value) { this[name] = value; } }];
  const document = {
    readyState: 'complete',
    createElement: () => ({}),
    getElementsByTagName: () => [{ parentNode: { insertBefore: (node) => appended.push(node) } }],
    querySelectorAll: () => fields,
    addEventListener: (name, fn) => { listeners[name] = fn; },
  };
  const window = { location: { pathname }, document };
  const navigator = { globalPrivacyControl: gpc, doNotTrack: dnt };
  const context = vm.createContext({ window, document, navigator });
  window.window = window;
  vm.runInContext(fs.readFileSync(path.join(PUBLIC, 'js', 'clarity.js'), 'utf8'), context);
  if (typeof window.clarity === 'function') {
    const original = window.clarity;
    window.clarity = (...args) => { clarityEvents.push(args); return original(...args); };
  }
  const click = (href) => {
    const anchor = { getAttribute: () => href };
    listeners.click?.({ target: { closest: () => anchor } });
  };
  for (const href of links) click(href);
  return { appended, clarityEvents, fields, listeners };
}

test('REQ-02: the loader installs the standard snippet for the ThumbGate project and masks form fields', () => {
  const run = runLoader();
  assert.equal(run.appended.length, 1);
  assert.equal(run.appended[0].src, `https://www.clarity.ms/tag/${CLARITY_ID}`);
  assert.ok(run.fields.every((field) => field['data-clarity-mask'] === 'True'), 'every form field is masked');
  const source = fs.readFileSync(path.join(PUBLIC, 'js', 'clarity.js'), 'utf8');
  assert.equal(/data-clarity-unmask|clarity\(\s*['"]consent|clarity\.\w*unmask/i.test(source), false, 'nothing overrides masking');
  for (const file of htmlFiles(PUBLIC)) assert.equal(/data-clarity-unmask/i.test(fs.readFileSync(file, 'utf8')), false, path.relative(PUBLIC, file));
});

test('REQ-02: a Pro checkout click sends the checkout_click event; other links do not', () => {
  const run = runLoader({ links: ['/checkout/pro', 'https://thumbgate.ai/checkout/pro?x=1', '/pricing', '/checkout/team'] });
  const events = run.clarityEvents.filter((args) => args[0] === 'event');
  assert.deepEqual(events, [['event', 'checkout_click'], ['event', 'checkout_click']]);
});

test('REQ-02: Clarity stays off for Global Privacy Control, Do Not Track and private paths', () => {
  assert.equal(runLoader({ gpc: true }).appended.length, 0);
  assert.equal(runLoader({ dnt: '1' }).appended.length, 0);
  for (const pathname of ['/admin', '/admin/', '/dashboard', '/lessons', '/onboarding', '/v1/admin/sources']) {
    assert.equal(runLoader({ pathname }).appended.length, 0, pathname);
  }
});

test('REQ-03: the owner console never loads Clarity, and the Sources tab is on its menu', () => {
  const admin = fs.readFileSync(path.join(PUBLIC, 'admin.html'), 'utf8');
  assert.equal(/clarity\.ms|\/js\/clarity\.js|plausible\.io|googletagmanager/i.test(admin), false);
  assert.match(admin, /sources: 'Sources'/);
  assert.match(admin, /'analytics', 'sources', 'observability'/);
});

function sourcesFixture({ withTags = true, rows = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-sources-'));
  const feedbackDir = path.join(dir, 'feedback');
  const publicDir = path.join(dir, 'public');
  fs.mkdirSync(feedbackDir, { recursive: true });
  fs.mkdirSync(path.join(publicDir, 'js'), { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'index.html'), withTags
    ? '<script defer data-domain="thumbgate.ai" src="https://plausible.io/js/script.js"></script><script defer src="/js/clarity.js"></script>__GA_BOOTSTRAP__'
    : '<html></html>');
  fs.writeFileSync(path.join(publicDir, 'js', 'clarity.js'), fs.readFileSync(path.join(PUBLIC, 'js', 'clarity.js'), 'utf8'));
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
    assert.equal(tiles.clarity.dashboardUrl, 'https://clarity.microsoft.com/projects/view/zjaflwztgq/gettingstarted');
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
    ],
  });
  try {
    const result = await collectSources({ feedbackDir: f.feedbackDir, publicDir: f.publicDir, env: {} });
    const tiles = Object.fromEntries(result.data.tiles.map((tile) => [tile.id, tile]));
    assert.equal(tiles.visitor.status, 'ok');
    assert.equal(tiles.visitor.count30d, 2);
    assert.equal(Date.parse(tiles.visitor.lastEventAt), Date.parse(iso(30)));
    assert.equal(tiles.install.count30d, 1, 'the owner install is not counted');
    assert.equal(Date.parse(tiles.install.lastEventAt), Date.parse(iso(60)));
    assert.equal(tiles.pro_checkout_click.count30d, 1);
    assert.equal(tiles.first_block.status, 'no_data_yet');
    for (const id of ['plausible', 'google_analytics', 'clarity']) assert.equal(tiles[id].status, 'not_installed', id);
    assert.equal(/api[_-]?key|token|secret/i.test(JSON.stringify(result)), false, 'no credential field in the payload');
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});
