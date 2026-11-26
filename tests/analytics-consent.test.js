'use strict';

// Consent-gated analytics (Instinct's privacy review, 26 Nov 2026): no Clarity or Orion request before the visitor
// accepts, none on private routes or for GPC/DNT visitors, and decline/withdraw stops both.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const clarity = require('../scripts/clarity');

const PAGE = '<html><head><title>t</title></head><body><a href="/checkout/pro">Pro</a></body></html>';
const CLARITY_SRC = 'https://www.clarity.ms/tag/zjaflwztgq';

function tagSource(html = PAGE, env = {}) {
  const out = clarity.injectAnalyticsTags(html, { pathname: '/', headers: {}, env });
  const match = /<script data-thumbgate-consent>([\s\S]*?)<\/script>/.exec(out);
  assert.ok(match, 'public page gets the consent tag');
  return match[1];
}

function makeElement(tag) {
  const el = {
    nodeType: 1, tagName: String(tag).toUpperCase(), children: [], attrs: {}, listeners: {}, style: {}, parentNode: null,
    setAttribute(k, v) { el.attrs[k] = String(v); }, getAttribute(k) { return k in el.attrs ? el.attrs[k] : null; },
    hasAttribute(k) { return k in el.attrs; },
    addEventListener(name, fn) { (el.listeners[name] = el.listeners[name] || []).push(fn); },
    appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
    removeChild(child) { el.children = el.children.filter((c) => c !== child); child.parentNode = null; },
  };
  return el;
}

function walk(el, fn) { fn(el); for (const c of el.children) walk(c, fn); }

function run({ source = tagSource(), gpc = false, dnt = null, stored = null, timeZone = 'UTC' } = {}) {
  const appended = [];
  const store = new Map(stored ? [['thumbgate_analytics_consent', stored]] : []);
  const body = makeElement('body');
  const docListeners = {};
  const document = {
    body,
    createElement: makeElement,
    getElementById: (id) => { let hit = null; walk(body, (n) => { if (n.id === id) hit = n; }); return hit; },
    getElementsByTagName: () => [{ parentNode: { insertBefore: (node) => appended.push(node) } }],
    addEventListener: (name, fn) => { (docListeners[name] = docListeners[name] || []).push(fn); },
  };
  const winListeners = {};
  let reloads = 0;
  const window = { document, doNotTrack: null, location: { reload: () => { reloads += 1; } }, addEventListener: (n, fn) => { (winListeners[n] = winListeners[n] || []).push(fn); }, localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) } };
  window.window = window;
  const Intl = { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone }) }) };
  vm.runInContext(source, vm.createContext({ window, document, Intl, navigator: { globalPrivacyControl: gpc, doNotTrack: dnt } }));
  const banner = () => document.getElementById('tg-consent');
  const press = (choice) => {
    let button = null;
    walk(body, (n) => { if (n.getAttribute && n.getAttribute('data-consent-choice') === choice) button = n; });
    assert.ok(button, `banner has a ${choice} button`);
    button.listeners.click.forEach((fn) => fn({}));
  };
  const click = (href) => {
    const anchor = { nodeType: 1, tagName: 'A', parentNode: null, getAttribute: (k) => (k === 'href' ? href : null), hasAttribute: () => false };
    (docListeners.click || []).forEach((fn) => fn({ target: anchor, preventDefault() {} }));
  };
  const queue = () => JSON.parse(JSON.stringify(window.clarity && window.clarity.q ? window.clarity.q.map((args) => Array.from(args)) : []));
  const storageEvent = (newValue) => (winListeners.storage || []).forEach((fn) => fn({ key: 'thumbgate_analytics_consent', newValue }));
  return { window, appended, store, banner, press, click, queue, storageEvent, reloads: () => reloads, srcs: () => appended.map((n) => n.src) };
}

test('REQ-01: before any choice, the banner shows and nothing loads or queues', () => {
  const r = run();
  assert.ok(r.banner(), 'banner shown');
  assert.deepEqual(r.appended, [], 'no Clarity or Orion script requested');
  assert.equal(r.window.clarity, undefined);
  assert.equal(r.window.orion, undefined);
  assert.equal(r.store.size, 0);
});

test('REQ-02 (accepted consent): Accept loads Clarity and Orion, grants analytics only, and remembers the choice', () => {
  const r = run();
  r.press('granted');
  assert.equal(r.banner(), null, 'banner removed');
  assert.deepEqual(r.srcs(), [CLARITY_SRC, clarity.ORION_SRC]);
  assert.deepEqual(r.queue()[0], ['consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' }]);
  assert.equal(r.store.get('thumbgate_analytics_consent'), 'granted');
  const again = run({ stored: 'granted' });
  assert.equal(again.banner(), null, 'no banner once accepted');
  assert.equal(again.appended.length, 2, 'a returning visitor who accepted loads both');
});

test('REQ-03: Decline loads nothing and is remembered', () => {
  const r = run();
  r.press('denied');
  assert.equal(r.banner(), null);
  assert.deepEqual(r.appended, []);
  assert.equal(r.store.get('thumbgate_analytics_consent'), 'denied');
  const again = run({ stored: 'denied' });
  assert.equal(again.banner(), null);
  assert.deepEqual(again.appended, []);
});

test('REQ-04: withdrawing after Accept sends Clarity the withdrawal and stops Orion', () => {
  const r = run({ stored: 'granted' });
  r.window.thumbgateConsent.decline();
  const q = r.queue();
  assert.deepEqual(q.slice(-2), [['consentv2', { ad_Storage: 'denied', analytics_Storage: 'denied' }], ['consent', false]]);
  assert.ok(r.window.__orion.q.some(([method]) => method === 'stop'), 'orion.stop() called');
  assert.equal(r.store.get('thumbgate_analytics_consent'), 'denied');
  r.window.thumbgateConsent.open();
  assert.ok(r.banner(), 'the choice can be reopened');
});

test('REQ-05: GPC and DNT visitors get no banner and no request, even with a stored Accept', () => {
  for (const opts of [{ gpc: true }, { dnt: '1' }, { gpc: true, stored: 'granted' }]) {
    const r = run(opts);
    assert.equal(r.banner(), null, JSON.stringify(opts));
    assert.deepEqual(r.appended, [], JSON.stringify(opts));
  }
});

test('REQ-06: private routes and GPC/DNT requests get no tag at all', () => {
  for (const pathname of ['/admin', '/dashboard', '/signin', '/checkout/pro', '/billing', '/success', '/lessons', '/v1/x']) {
    assert.equal(clarity.injectAnalyticsTags(PAGE, { pathname, env: {} }), PAGE, pathname);
  }
  assert.equal(clarity.injectAnalyticsTags(PAGE, { pathname: '/', headers: { 'sec-gpc': '1' }, env: {} }), PAGE);
  assert.equal(clarity.injectAnalyticsTags(PAGE, { pathname: '/', headers: { dnt: '1' }, env: {} }), PAGE);
  assert.equal(clarity.injectAnalyticsTags(PAGE, { pathname: '/', env: { THUMBGATE_CLARITY_PROJECT_ID: 'off', THUMBGATE_ORION: 'off' } }), PAGE);
  const once = clarity.injectAnalyticsTags(PAGE, { pathname: '/', env: {} });
  assert.equal(clarity.injectAnalyticsTags(once, { pathname: '/', env: {} }), once, 'injected once');
  assert.equal((once.match(/clarity\.ms\/tag\//g) || []).length, 1);
});

test('REQ-07: after Accept, a Pro checkout click sends checkout_click; other links send nothing; none before Accept', () => {
  const before = run();
  before.click('/checkout/pro');
  assert.deepEqual(before.queue(), [], 'no event before consent');
  const r = run({ stored: 'granted' });
  for (const href of ['/checkout/pro', 'https://thumbgate.ai/checkout/pro?x=1', '/pricing', '/checkout/team']) r.click(href);
  assert.deepEqual(r.queue().filter((c) => c[0] === 'event'), [['event', 'checkout_click'], ['event', 'checkout_click']]);
});

test('REQ-08: Orion switched off leaves only Clarity behind the banner, and the tag never identifies anyone', () => {
  const r = run({ source: tagSource(PAGE, { THUMBGATE_ORION: 'off' }) });
  r.press('granted');
  assert.deepEqual(r.srcs(), [CLARITY_SRC]);
  assert.equal(/orion\.identify\(/.test(tagSource()), false);
});

test('REQ-09: accepting again after a withdrawal on the same page re-grants Clarity and reloads to restart Orion', () => {
  const r = run({ stored: 'granted' });
  r.window.thumbgateConsent.decline();
  r.window.thumbgateConsent.accept();
  assert.deepEqual(r.queue().slice(-1), [['consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' }]]);
  assert.equal(r.reloads(), 1, 'Orion cannot restart after stop(), so the page reloads');
  assert.equal(r.appended.length, 2, 'scripts are not added twice');
  const clarityOnly = run({ source: tagSource(PAGE, { THUMBGATE_ORION: 'off' }), stored: 'granted' });
  clarityOnly.window.thumbgateConsent.decline();
  clarityOnly.window.thumbgateConsent.accept();
  assert.equal(clarityOnly.reloads(), 0, 'Clarity alone needs no reload');
});

test('REQ-10: a withdrawal in another tab stops analytics in this one; an Accept elsewhere loads it here', () => {
  const r = run({ stored: 'granted' });
  r.storageEvent('denied');
  assert.deepEqual(r.queue().slice(-2), [['consentv2', { ad_Storage: 'denied', analytics_Storage: 'denied' }], ['consent', false]]);
  assert.ok(r.window.__orion.q.some(([method]) => method === 'stop'));
  const fresh = run();
  fresh.storageEvent('granted');
  assert.equal(fresh.banner(), null, 'banner closes');
  assert.equal(fresh.appended.length, 2);
});

test('REQ-11: no browser time-zone or region rule decides consent; the owner console says Accept is required', () => {
  const code = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'scripts', 'clarity.js'), 'utf8');
  assert.equal(/Intl\.DateTimeFormat|timeZone|Europe\//.test(code), false, 'no time-zone consent guess');
  for (const timeZone of ['Europe/Berlin', 'Europe/London', 'America/New_York']) {
    const r = run({ timeZone });
    assert.deepEqual(r.appended, [], `${timeZone}: nothing loads before Accept`);
    assert.deepEqual(r.queue(), [], `${timeZone}: nothing granted before Accept`);
    r.press('granted');
    assert.deepEqual(r.srcs(), [CLARITY_SRC, clarity.ORION_SRC], `${timeZone}: Accept loads`);
    assert.deepEqual(r.queue()[0], ['consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' }]);
  }
});
