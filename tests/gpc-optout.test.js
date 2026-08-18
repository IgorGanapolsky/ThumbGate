'use strict';

/**
 * gpc-optout.test.js
 *
 * The privacy notice claims we honor Global Privacy Control and Do Not Track.
 * A claim in a legal page that no code enforces is worse than no claim at all,
 * so this test executes the homepage's actual telemetry function against both
 * a known-bad input (signal set -> must NOT emit) and a known-good input
 * (no signal -> must emit). Two-sided, deliberately: a suppression test that
 * only checks the blocking case passes trivially if the function is broken and
 * never emits anything.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML = path.join(__dirname, '..', 'public', 'index.html');

/** Pull the two functions out of the page so we test shipped code, not a copy. */
function loadTelemetryFns(navigatorStub, windowStub) {
  const html = fs.readFileSync(HTML, 'utf8');

  const optOutSrc = html.match(/function privacySignalOptOut\(\)[\s\S]*?\n    \}/);
  assert.ok(optOutSrc, 'privacySignalOptOut must exist in public/index.html');

  const sendSrc = html.match(/function sendFirstPartyTelemetry\(eventName, props\)[\s\S]*?\n    \}/);
  assert.ok(sendSrc, 'sendFirstPartyTelemetry must exist in public/index.html');

  const sent = [];
  const sandbox = {
    navigator: navigatorStub,
    window: windowStub,
    // Any emit path records a call. If suppression leaks, one of these fires.
    Blob: function Blob(parts) { this.parts = parts; },
    fetch: (...args) => { sent.push(['fetch', args[0]]); return Promise.resolve(); },
    JSON,
    console,
    serverVisitorId: 'v-123',
    serverSessionId: 's-456',
    serverAcquisitionId: 'a-789',
    sent,
  };
  sandbox.navigator.sendBeacon = (url) => { sent.push(['beacon', url]); return true; };
  vm.createContext(sandbox);
  vm.runInContext(`${optOutSrc[0]}\n${sendSrc[0]}`, sandbox);
  return { sandbox, sent };
}

test('GPC set: telemetry is suppressed at the point of collection', () => {
  const { sandbox, sent } = loadTelemetryFns({ globalPrivacyControl: true }, {});
  sandbox.sendFirstPartyTelemetry('page_view', { a: 1 });
  assert.equal(sent.length, 0, 'no beacon or fetch may fire when GPC is set');
});

test('Do Not Track set (navigator and window forms): telemetry is suppressed', () => {
  for (const [nav, win] of [
    [{ doNotTrack: '1' }, {}],
    [{}, { doNotTrack: '1' }],
  ]) {
    const { sandbox, sent } = loadTelemetryFns(nav, win);
    sandbox.sendFirstPartyTelemetry('page_view', {});
    assert.equal(sent.length, 0, 'DNT must suppress the emit');
  }
});

test('no privacy signal: telemetry still emits (suppression is not blanket)', () => {
  const { sandbox, sent } = loadTelemetryFns({}, {});
  sandbox.sendFirstPartyTelemetry('page_view', { a: 1 });
  assert.equal(sent.length, 1, 'absent any signal the page must still report');
  assert.equal(sent[0][1], '/v1/telemetry/ping');
});

test('a hostile navigator that throws on property access does not break the page', () => {
  const hostile = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'sendBeacon') return () => true;
      throw new Error('navigator access denied');
    },
  });
  // Must not throw. Failing open here is deliberate: a broken browser API should
  // not take down the marketing page, and the CLI/server paths gate separately.
  assert.doesNotThrow(() => {
    const { sandbox } = loadTelemetryFns(hostile, {});
    sandbox.sendFirstPartyTelemetry('page_view', {});
  });
});

test('privacy notice does not claim anonymity it cannot deliver', () => {
  const privacy = fs.readFileSync(path.join(__dirname, '..', 'public', 'privacy.html'), 'utf8');
  // The page DOES attach visitorId/sessionId, so "anonymous" would be false.
  assert.match(privacy, /pseudonymous/i, 'analytics must be described as pseudonymous');
  assert.match(privacy, /visitor identifier/i);
  assert.match(privacy, /session identifier/i);
  assert.ok(
    !/anonymous analytics/i.test(privacy),
    'must not call marketing analytics anonymous while identifiers are attached',
  );
  assert.ok(
    !/analytics[^.]{0,80}are anonymous/i.test(privacy),
    'must not assert marketing analytics are anonymous while identifiers are attached',
  );
  assert.match(privacy, /Global Privacy Control/i);
});

test('appendTelemetryEvent: GPC header discards, no header still writes', () => {
  const {
    appendTelemetryEvent,
    TELEMETRY_FILE_NAME,
  } = require('../scripts/telemetry-analytics');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-gpc-persist-'));
  const file = path.join(dir, TELEMETRY_FILE_NAME);

  const discarded = appendTelemetryEvent(dir, {
    eventType: 'page_view',
    clientType: 'web',
    visitorId: 'gpc-blocked',
  }, { 'Sec-GPC': '1' });
  assert.equal(discarded, null);
  assert.equal(fs.existsSync(file), false, 'opt-out must not create the log');

  const written = appendTelemetryEvent(dir, {
    eventType: 'page_view',
    clientType: 'web',
    visitorId: 'gpc-allowed',
  }, {});
  assert.ok(written);
  assert.equal(written.visitorId, 'gpc-allowed');
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1, 'only the no-signal event may persist');
});

test('appendTelemetryEvent: DNT: 1 also discards', () => {
  const { appendTelemetryEvent, TELEMETRY_FILE_NAME } = require('../scripts/telemetry-analytics');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-dnt-persist-'));
  assert.equal(appendTelemetryEvent(dir, { visitorId: 'dnt-blocked' }, { dnt: '1' }), null);
  assert.equal(fs.existsSync(path.join(dir, TELEMETRY_FILE_NAME)), false);
});
