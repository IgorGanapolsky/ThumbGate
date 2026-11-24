'use strict';

// The owner console's Observability tab: the report is built from our own logs, every block either has its
// numbers and a source or says why it has none, and the page shows plain words (no field names, no bare numbers).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const report = require('../scripts/ops-report');
const opsLog = require('../scripts/ops-log');
const admin = require('../scripts/owner-admin');

const MIN = 60000;
const HOUR = 3600000;
const NOW = Date.parse('2026-11-19T21:00:00Z');
const beatsFor = (minutes, skip = []) => { const out = []; for (let i = minutes; i >= 0; i -= 1) if (!skip.includes(i)) out.push(NOW - i * MIN); return out; };
const base = (extra = {}) => ({
  now: NOW,
  beats: beatsFor(600),
  events: [],
  speed: { page: { samples: 50, p50: 12, p95: 80 }, api: { samples: 40, p50: 9, p95: 55 }, telemetry: { samples: 900, p50: 3, p95: 14 } },
  startedAt: new Date(NOW - 10 * MIN).toISOString(),
  uptimeSeconds: 600,
  sha: '1ba5043d2ade4dcef85bd114a8fc3e4b6f40062f',
  commitTitle: 'fix(admin): stream telemetry for Analytics and Money',
  repo: 'IgorGanapolsky/ThumbGate',
  disk: { capacityBytes: 10 * 1024 ** 3, usedBytes: 2.5 * 1024 ** 3 },
  ...extra,
});
const error = (agoMs, what = 'Checkout failed', status = 500) => ({ time: NOW - agoMs, kind: 'error', what, status });

test('a quiet site reads green in one plain sentence', () => {
  const r = report.buildReport(base());
  assert.equal(r.headline.level, 'green');
  assert.equal(r.headline.sentence, 'All good: site up, no errors in the last hour.');
});

test('uptime is a percentage over 30 days with the last outage, from the heartbeat', () => {
  const r = report.buildReport(base({ beats: beatsFor(600, [300, 299, 298, 297, 296, 295]) }));
  assert.ok(r.uptime.percent < 100 && r.uptime.percent > 98, 'percent ' + r.uptime.percent);
  assert.equal(r.uptime.lastOutage.minutes, 6);
  assert.equal(r.uptime.lastOutage.startedAt, new Date(NOW - 301 * MIN + MIN).toISOString());
  assert.equal(r.headline.level, 'amber');
  assert.match(r.headline.sentence, /the site was down for 6 minutes, 5 hours ago/);
});

test('without heartbeats uptime says it is not collected yet, never a number', () => {
  const r = report.buildReport(base({ beats: [] }));
  assert.equal(r.uptime.percent, null);
  assert.match(r.uptime.reason, /not collected yet/);
});

test('errors: counts for the last hour and 24 hours, and the top 5 in plain words with count and last seen', () => {
  const events = [error(5 * MIN), error(10 * MIN), error(2 * HOUR, 'API request failed', 502), error(3 * HOUR, 'Web page failed'), error(4 * HOUR, 'Sign-in or sign-out failed'), error(5 * HOUR, 'Dashboard page failed'), error(6 * HOUR, 'Site telemetry was not saved'), error(30 * HOUR)];
  const r = report.buildReport(base({ events }));
  assert.equal(r.errors.lastHour, 2);
  assert.equal(r.errors.last24Hours, 7);
  assert.equal(r.errors.top.length, 5);
  assert.deepEqual(r.errors.top[0], { what: 'Checkout failed', status: 500, count: 2, lastSeenAt: new Date(NOW - 5 * MIN).toISOString() });
  assert.equal(r.headline.level, 'amber');
  assert.match(r.headline.sentence, /^Needs a look: 2 server errors in the last hour/);
});

test('ten errors in an hour is red', () => {
  const r = report.buildReport(base({ events: Array.from({ length: 10 }, (_, i) => error(i * MIN + 1000)) }));
  assert.equal(r.headline.level, 'red');
  assert.match(r.headline.sentence, /^Problem: /);
});

test('speed: typical and slowest 5 percent per area, or the reason there are none', () => {
  const r = report.buildReport(base());
  assert.deepEqual(r.speed.groups.map((g) => [g.name, g.typicalMs, g.slowestFivePercentMs]), [['Web pages', 12, 80], ['API', 9, 55], ['Site telemetry', 3, 14]]);
  const none = report.buildReport(base({ speed: {} }));
  assert.deepEqual(none.speed.groups, []);
  assert.match(none.speed.reason, /No requests have been measured/);
});

test('last deploy: short SHA linked to GitHub with the commit title', () => {
  const r = report.buildReport(base());
  assert.equal(r.lastDeploy.shortSha, '1ba5043d2');
  assert.equal(r.lastDeploy.commitUrl, 'https://github.com/IgorGanapolsky/ThumbGate/commit/1ba5043d2ade4dcef85bd114a8fc3e4b6f40062f');
  assert.equal(r.lastDeploy.commitTitle, 'fix(admin): stream telemetry for Analytics and Money');
  assert.equal(r.lastDeploy.reason, null);
  const noTitle = report.buildReport(base({ commitTitle: null, commitTitleReason: 'GitHub did not return the commit title.' }));
  assert.match(noTitle.lastDeploy.reason, /GitHub did not return/);
  const noSha = report.buildReport(base({ sha: null }));
  assert.equal(noSha.lastDeploy.commitUrl, null);
  assert.match(noSha.lastDeploy.reason, /did not report which commit/);
});

test('Stripe webhooks and failed sign-ins come from the log; a failure within the hour is red', () => {
  const events = [
    { time: NOW - 30 * MIN, kind: 'webhook', ok: true, status: 200 },
    { time: NOW - 20 * MIN, kind: 'webhook', ok: false, status: 503 },
    ...Array.from({ length: 6 }, (_, i) => ({ time: NOW - (i + 1) * HOUR, kind: 'sign_in_failed', reason: i < 4 ? 'invalid_state' : 'expired_token' })),
  ];
  const r = report.buildReport(base({ events }));
  assert.equal(r.webhooks.lastArrivedAt, new Date(NOW - 20 * MIN).toISOString());
  assert.equal(r.webhooks.failures24h, 1);
  assert.equal(r.signIn.failed24h, 6);
  assert.deepEqual(r.signIn.reasons, [{ words: 'sign-in link expired or was reused', count: 4 }, { words: 'token had expired', count: 2 }]);
  assert.equal(r.headline.level, 'red');
});

test('disk is used and total in GB with a percentage', () => {
  const r = report.buildReport(base());
  assert.deepEqual([r.disk.usedGb, r.disk.capacityGb, r.disk.percent], [2.5, 10, 25]);
  assert.match(report.buildReport(base({ disk: null })).disk.reason, /could not be read/);
});

test('ops log: heartbeat and events are written and read back, and a removed directory is not recreated', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-log-'));
  try {
    const stop = opsLog.startHeartbeat(dir);
    opsLog.recordError('/v1/billing/checkout/session?x=1', 502);
    opsLog.recordWebhook(true, 200);
    opsLog.recordSignInFailure('invalid_state');
    opsLog.recordSignInFailure('Robert; DROP TABLE');
    stop();
    const events = (await opsLog.readLog(dir, opsLog.EVENTS_FILE)).rows;
    assert.deepEqual(events.map((e) => e.kind).sort(), ['error', 'sign_in_failed', 'sign_in_failed', 'webhook']);
    assert.equal(events.find((e) => e.kind === 'error').what, 'Checkout failed');
    assert.ok(!JSON.stringify(events).includes('x=1'), 'no query string is stored');
    assert.deepEqual(events.filter((e) => e.kind === 'sign_in_failed').map((e) => e.reason).sort(), ['invalid_state', 'sign_in_failed']);
    assert.equal((await opsLog.readLog(dir, opsLog.HEARTBEAT_FILE)).rows.length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.equal(opsLog.recordError('/x', 500), false);
  assert.equal(fs.existsSync(dir), false, 'the directory stays removed');
  opsLog.setDirectory(null);
});

test('collectObservability returns the report built from the ops log and the in-memory timings', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-collect-'));
  try {
    const now = Date.now();
    fs.writeFileSync(path.join(dir, opsLog.HEARTBEAT_FILE), [now - 20 * MIN, now - 19 * MIN, now - 18 * MIN, now - 1 * MIN].map((t) => JSON.stringify({ timestamp: new Date(t).toISOString() })).join('\n') + '\n');
    fs.writeFileSync(path.join(dir, opsLog.EVENTS_FILE), JSON.stringify({ timestamp: new Date(now - 5 * MIN).toISOString(), kind: 'error', what: 'Checkout failed', status: 500 }) + '\n');
    const runtime = admin.createRuntimeObservations();
    for (const ms of [5, 6, 7, 8, 9, 10, 11, 12, 13, 200]) runtime.recordTiming('page', ms);
    const result = await admin.collectAdminSection({ section: 'observability' }, { feedbackDir: dir, buildMetadata: { buildSha: 'abcdef1234567890' }, runtime, health: () => ({ version: '1.0.0', buildSha: 'abcdef1234567890', uptime: 125 }), lookupCommitTitle: async () => 'a commit title' });
    const r = result.data.report;
    assert.equal(r.errors.lastHour, 1);
    assert.equal(r.lastDeploy.commitTitle, 'a commit title');
    assert.equal(r.lastDeploy.shortSha, 'abcdef123');
    assert.deepEqual(r.speed.groups[0], { name: 'Web pages', samples: 10, typicalMs: 9, slowestFivePercentMs: 200 });
    assert.equal(r.runningFor.seconds, 125);
    assert.equal(r.uptime.lastOutage.minutes, 16);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- the page -----------------------------------------------------------------------------------------------------

function fakeElement(tag) {
  return { tag, children: [], className: '', textContent: '', style: {}, classList: { add() {}, remove() {}, toggle() {} }, append(...nodes) { this.children.push(...nodes); }, replaceChildren(...nodes) { this.children = nodes; }, remove() {}, setAttribute() {}, addEventListener() {} };
}

function renderObservability(data) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  const script = html.match(/<script nonce="__ADMIN_NONCE__">([\s\S]*?)<\/script>/)[1];
  const context = { document: { getElementById: () => fakeElement('div'), createElement: fakeElement, createTextNode: (text) => ({ tag: '#text', textContent: text, children: [] }), createElementNS: (ns, tag) => fakeElement(tag), body: fakeElement('body') }, fetch: () => new Promise(() => {}), location: { assign() {} }, Node: function Node() {}, Intl, URLSearchParams, console };
  vm.createContext(context);
  vm.runInContext(script + '\n;globalThis.__render = render;', context);
  const parent = fakeElement('section');
  context.__render(parent, 'observability', data);
  return parent;
}

function walk(node, parent = null, found = []) {
  if (!node || typeof node !== 'object') return found;
  found.push({ node, parent });
  for (const child of node.children || []) walk(child, node, found);
  return found;
}

const camelCase = /[a-z][A-Z]/;
const digitGlued = /[A-Za-z]\d|\d[A-Za-z]/;
const bad = /\b(unknown|null|undefined|nan)\b/i;

function checkPage(page, name) {
  const items = walk(page).filter(({ node }) => node.textContent);
  assert.ok(items.length > 0, name + ' rendered something');
  for (const { node, parent } of items) {
    const text = String(node.textContent);
    if (node.tag === 'a') continue; // the short commit SHA is the one machine string on the page
    const plain = text.replaceAll('ThumbGate', 'Brand').replaceAll('GitHub', 'Brand');
    assert.ok(!camelCase.test(plain), name + ': camelCase in "' + text + '"');
    assert.ok(!digitGlued.test(plain.replace(/\b\d{1,2}(:\d{2})? ?(AM|PM)\b/gi, '')), name + ': digit glued to a word in "' + text + '"');
    assert.ok(!bad.test(text), name + ': bare placeholder in "' + text + '"');
    if (/^[\d.,%\s]+$/.test(text)) {
      const isCardValue = node.className === 'value' && parent.children.some((sibling) => sibling.className === 'label' && sibling.textContent);
      assert.ok(isCardValue || node.tag === 'td', name + ': bare number "' + text + '"');
    }
  }
  return items.map(({ node }) => String(node.textContent));
}

const scenarios = {
  'everything present': base({ events: [error(5 * MIN), { time: NOW - 40 * MIN, kind: 'webhook', ok: true, status: 200 }, { time: NOW - 2 * HOUR, kind: 'sign_in_failed', reason: 'invalid_state' }] }),
  'no logs at all': base({ beats: [], events: [] }),
  'no response timings': base({ speed: null }),
  'no commit, no title': base({ sha: null, commitTitle: null }),
  'commit but title lookup failed': base({ commitTitle: null, commitTitleReason: 'GitHub did not return the commit title.' }),
  'no disk reading': base({ disk: null }),
  'no uptime reading': base({ uptimeSeconds: null }),
  'heartbeat just started': base({ beats: [NOW - 2 * MIN, NOW - MIN] }),
  'quiet logs, first hour': base({ beats: beatsFor(20) }),
  'long outage and failures': base({ beats: beatsFor(600, Array.from({ length: 90 }, (_, i) => 200 + i)), events: Array.from({ length: 12 }, (_, i) => error(i * MIN + 1000, i % 2 ? 'API request failed' : 'Web page failed', 500 + (i % 3))) }),
};

test('the tab renders in plain words for every source present or missing: no camelCase, no bare number, no bare Unknown', () => {
  for (const [name, input] of Object.entries(scenarios)) checkPage(renderObservability(JSON.parse(JSON.stringify({ report: report.buildReport(input) }))) , name);
});

test('the tab shows the sentence, the percentage, the disk sentence, the running sentence and the linked SHA', () => {
  const page = renderObservability({ report: report.buildReport(scenarios['everything present']) });
  const texts = walk(page).filter(({ node }) => node.textContent).map(({ node }) => String(node.textContent));
  assert.ok(texts.some((t) => /^Needs a look: 1 server error in the last hour/.test(t)));
  assert.ok(texts.some((t) => /^\d+(\.\d+)?%$/.test(t)), 'uptime percentage');
  assert.ok(texts.includes('2.5 GB of 10 GB used (25%)'));
  assert.ok(texts.some((t) => /^Running for 10 minutes since /.test(t)));
  const link = walk(page).map(({ node }) => node).find((node) => node.tag === 'a');
  assert.equal(link.textContent, '1ba5043d2');
  assert.equal(link.href, 'https://github.com/IgorGanapolsky/ThumbGate/commit/1ba5043d2ade4dcef85bd114a8fc3e4b6f40062f');
});

test('the checker itself rejects camelCase, glued digits, bare numbers and Unknown', () => {
  const fake = (children) => ({ tag: 'section', children, textContent: '' });
  const text = (tag, textContent, className = '') => ({ tag, textContent, className, children: [] });
  for (const broken of [text('p', 'uptimeSeconds'), text('p', 'Checkouts7d'), text('p', 'Unknown'), text('div', '593', 'value')]) {
    assert.throws(() => checkPage(fake([broken]), 'broken'));
  }
  assert.doesNotThrow(() => checkPage(fake([{ tag: 'div', textContent: '', className: 'card', children: [text('div', '593', 'value'), text('div', 'Errors in the last hour', 'label')] }]), 'ok'));
});
