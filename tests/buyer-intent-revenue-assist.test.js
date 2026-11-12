'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BUYER_INTENT = fs.readFileSync(path.join(ROOT, 'public', 'js', 'buyer-intent.js'), 'utf8');

const HIGH_TRAFFIC_PAGES = [
  'public/guide.html',
  'public/ai-malpractice-prevention.html',
  'public/dashboard.html',
  'public/learn.html',
  'public/lessons.html',
  'public/learn/ai-agent-persistent-memory.html',
  'public/learn/agent-harness-pattern.html',
];

test('buyer intent script exposes paid CTA and abandon reason observability', () => {
  assert.match(BUYER_INTENT, /initializeRevenueAssist/);
  assert.match(BUYER_INTENT, /assist_cta_impression/);
  assert.match(BUYER_INTENT, /assist_cta_click/);
  assert.match(BUYER_INTENT, /checkout_abandon_prompt/);
  assert.match(BUYER_INTENT, /checkout_abandon_reason/);
  assert.match(BUYER_INTENT, /plausible\.q/);
  assert.match(BUYER_INTENT, /fit_unclear/);
  assert.match(BUYER_INTENT, /need_proof/);
  assert.match(BUYER_INTENT, /price_scope_unclear/);
  assert.match(BUYER_INTENT, /researching/);
});

test('abandon survey requires a prior checkout visit and never fires on generic dwell or exit intent', () => {
  assert.match(BUYER_INTENT, /wasSurveyShown\(\) \|\| !checkoutWasSeen\(\)/);
  assert.match(BUYER_INTENT, /showAbandonSurvey\('checkout_return'\)/);
  assert.match(BUYER_INTENT, /function scheduleCheckoutReturnSurvey\(\)/);
  assert.match(BUYER_INTENT, /global\.addEventListener\('pageshow', scheduleCheckoutReturnSurvey\)/);
  assert.match(BUYER_INTENT, /global\.clearTimeout\(checkoutReturnTimer\)/);
  assert.match(BUYER_INTENT, /What stopped you from completing checkout\?/);
  assert.doesNotMatch(BUYER_INTENT, /showAbandonSurvey\('dwell_45s'\)/);
  assert.doesNotMatch(BUYER_INTENT, /showAbandonSurvey\('exit_intent'\)/);
  assert.doesNotMatch(BUYER_INTENT, /showAbandonSurvey\('cta_dismiss'\)/);
});

test('revenue assist routes workflow help through intake, not blind diagnostic checkout', () => {
  const intakeLinkTemplate = BUYER_INTENT.match(/<a data-assist-cta="assist_workflow_intake"[^;]+Send workflow first<\/a>/);

  assert.ok(intakeLinkTemplate, 'workflow intake CTA template should exist');
  assert.match(intakeLinkTemplate[0], /href="'\s*\+\s*intakeHref\s*\+\s*'"/);
  assert.doesNotMatch(BUYER_INTENT, /Pay \$499 diagnostic/);
  assert.doesNotMatch(BUYER_INTENT, /assist_workflow_diagnostic/);
  assert.doesNotMatch(BUYER_INTENT, /https:\/\/buy\.stripe\.com\/00w14neyUcXA5pL5e33sI0e/);
});

test('paid revenue assist does not inject on checkout routes', () => {
  assert.match(BUYER_INTENT, /path === '\/checkout\/pro'/);
  assert.match(BUYER_INTENT, /path\.indexOf\('\/go\/pro'\) === 0/);
});

test('high traffic pages load buyer intent conversion assist', () => {
  for (const relativePath of HIGH_TRAFFIC_PAGES) {
    const html = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
    assert.match(html, /<script src="\/js\/buyer-intent\.js"><\/script>/, relativePath);
  }
});

test('revenue assist popup checks /v1/auth/session (credentials: include) and stays hidden for Pro and Enterprise sessions', async () => {
  const vm = require('node:vm');

  async function runRevenueAssistWithSession(sessionResponse, { status = 200, throwErr = false } = {}) {
    const appended = [];
    const fetchCalls = [];
    const tracked = [];
    const makeEl = (tag) => ({
      tagName: String(tag).toUpperCase(),
      id: '',
      textContent: '',
      innerHTML: '',
      attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; },
      getAttribute(k) { return this.attrs[k]; },
      querySelectorAll() { return []; },
      querySelector() { return null; },
      addEventListener() {},
      remove() {
        const idx = appended.indexOf(this);
        if (idx >= 0) appended.splice(idx, 1);
      },
    });
    const doc = {
      readyState: 'loading',
      head: { appendChild() {} },
      body: { appendChild(el) { appended.push(el); } },
      getElementById() { return null; },
      createElement: makeEl,
      querySelector(sel) {
        if (sel === '[data-thumbgate-revenue-assist]') {
          return appended.find((el) => el.attrs['data-thumbgate-revenue-assist']) || null;
        }
        return null;
      },
      querySelectorAll(sel) {
        if (sel.includes('data-thumbgate-revenue-assist')) {
          return appended.filter((el) => el.attrs['data-thumbgate-revenue-assist']);
        }
        return [];
      },
      addEventListener() {},
    };
    const sandbox = {
      location: { origin: 'https://thumbgate.ai', pathname: '/lessons' },
      document: doc,
      plausible(eventName) { tracked.push(eventName); },
      fetch: async (url, opts) => {
        fetchCalls.push({ url, opts });
        if (throwErr) throw new Error('network error');
        return { ok: status >= 200 && status < 300, status, json: async () => sessionResponse };
      },
      URL,
      URLSearchParams,
      setTimeout: () => 1,
      clearTimeout: () => {},
      addEventListener() {},
    };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(BUYER_INTENT, sandbox);
    const result = await sandbox.ThumbGateBuyerIntent.initializeRevenueAssist({ pathname: '/lessons' });
    return { result, appended, fetchCalls, tracked };
  }

  const proRun = await runRevenueAssistWithSession({ ok: true, authenticated: true, tier: 'Pro' });
  assert.equal(proRun.result, null);
  assert.equal(proRun.appended.length, 0, 'Pro session must never render revenue assist popup');
  assert.deepEqual(proRun.tracked, [], 'Pro session must not fire assist_cta_impression');
  assert.equal(proRun.fetchCalls[0].url, '/v1/auth/session');
  assert.equal(proRun.fetchCalls[0].opts.credentials, 'include');

  const entRun = await runRevenueAssistWithSession({ ok: true, authenticated: true, tier: 'Enterprise' });
  assert.equal(entRun.result, null);
  assert.equal(entRun.appended.length, 0, 'Enterprise session must never render revenue assist popup');

  const freeRun = await runRevenueAssistWithSession({ ok: true, authenticated: true, tier: 'Free' });
  assert.ok(freeRun.result && freeRun.result.panel, 'Free session still renders revenue assist popup');
  assert.equal(freeRun.appended.length, 1);

  const anonRun = await runRevenueAssistWithSession({ ok: true, authenticated: false, tier: null });
  assert.ok(anonRun.result && anonRun.result.panel, 'Anonymous visitor still renders revenue assist popup');
  assert.equal(anonRun.appended.length, 1);

  const offlineRun = await runRevenueAssistWithSession(null, { throwErr: true });
  assert.ok(offlineRun.result && offlineRun.result.panel, 'Session fetch failure degrades gracefully for anonymous visitors');
});
