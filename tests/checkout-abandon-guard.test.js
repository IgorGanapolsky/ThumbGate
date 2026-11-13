'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  classifyRequester,
  isHumanCheckoutNavigation,
} = require('../scripts/bot-detection');
const { containsEconomicUrl } = require('../scripts/financial-control-plane');

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

describe('checkout abandonment guards (agents, link scanners, and funnel exclusion)', () => {
  it('deflects non-user-activated programmatic and crawler navigations while allowing real clicks', () => {
    assert.equal(
      isHumanCheckoutNavigation(
        {
          'user-agent': CHROME_UA,
          accept: HTML_ACCEPT,
          'sec-fetch-mode': 'navigate',
          'sec-fetch-dest': 'document',
          'sec-fetch-site': 'none',
        },
        'https://thumbgate.ai',
      ),
      false,
      'page.goto / headless crawler with Sec-Fetch-Site: none and no Sec-Fetch-User: ?1 must be deflected',
    );

    assert.equal(
      isHumanCheckoutNavigation(
        {
          'user-agent': CHROME_UA,
          accept: HTML_ACCEPT,
          'sec-fetch-mode': 'navigate',
          'sec-fetch-dest': 'document',
          'sec-fetch-site': 'cross-site',
        },
        'https://thumbgate.ai',
      ),
      false,
      'cross-site link scanner without Sec-Fetch-User: ?1 must be deflected',
    );

    assert.equal(
      isHumanCheckoutNavigation(
        {
          'user-agent': CHROME_UA,
          accept: HTML_ACCEPT,
          'sec-fetch-mode': 'navigate',
          'sec-fetch-dest': 'document',
          'sec-fetch-site': 'same-origin',
        },
        'https://thumbgate.ai',
      ),
      true,
      'same-origin click on thumbgate.ai (including Safari without Sec-Fetch-User) must pass',
    );

    assert.equal(
      isHumanCheckoutNavigation(
        {
          'user-agent': CHROME_UA,
          accept: HTML_ACCEPT,
          'sec-fetch-mode': 'navigate',
          'sec-fetch-dest': 'document',
          'sec-fetch-site': 'cross-site',
          'sec-fetch-user': '?1',
        },
        'https://thumbgate.ai',
      ),
      true,
      'external link click with Sec-Fetch-User: ?1 must pass',
    );

    assert.equal(
      isHumanCheckoutNavigation(
        {
          'user-agent': CHROME_UA,
          accept: HTML_ACCEPT,
          'sec-fetch-mode': 'navigate',
          'sec-fetch-dest': 'document',
          'sec-fetch-site': 'none',
          'sec-fetch-user': '?1',
        },
        'https://thumbgate.ai',
      ),
      true,
      'user-typed omnibox navigation with Sec-Fetch-User: ?1 must pass',
    );
  });

  it('classifies internal audit probes, fuzzers, and bare Mozilla/5.0 User-Agents as bots', () => {
    for (const ua of [
      'Mozilla/5.0',
      'firstpage/0.1',
      'MONEY-v6-Audit',
      'ProtocolV1-Gate/1.0',
      'Fuzz Faster U Fool v2.1.0-dev',
      'BrowserOS/1.0',
    ]) {
      const res = classifyRequester({ 'user-agent': ua, accept: HTML_ACCEPT });
      assert.equal(res.isBot, true, `expected ${ua} to be classified as bot`);
    }
  });

  it('blocks agent commands targeting live /go/* checkout session minters unless ?probe=1 is set', () => {
    assert.equal(containsEconomicUrl('curl -fsSI https://thumbgate.ai/go/pro-direct'), true);
    assert.equal(containsEconomicUrl('open https://www.thumbgate.ai/go/pro-annual?utm_source=pricing'), true);
    assert.equal(containsEconomicUrl('curl https://thumbgate.ai/go/bundle-49'), true);
    assert.equal(containsEconomicUrl('curl https://thumbgate.ai/go/playbook-999'), true);
    assert.equal(
      containsEconomicUrl('curl -fsS https://thumbgate.ai/go/pro-direct?probe=1'),
      false,
      'explicit ?probe=1 verification must stay allowed',
    );
    assert.equal(
      containsEconomicUrl('curl -fsS https://thumbgate.ai/pricing'),
      false,
      'read-only marketing pages must stay allowed',
    );
  });

  it('excludes synthetic, owner, bot, and rapid multi-CTA agent sweeps from funnel acquisition and signups', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-checkout-abandon-funnel-'));
    const saved = {
      feedbackDir: process.env.THUMBGATE_FEEDBACK_DIR,
      funnelPath: process.env._TEST_FUNNEL_LEDGER_PATH,
      revenuePath: process.env._TEST_REVENUE_LEDGER_PATH,
      keysPath: process.env._TEST_API_KEYS_PATH,
      sessionsPath: process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH,
      ownerEmails: process.env.THUMBGATE_OWNER_EMAILS,
    };

    try {
      const funnelPath = path.join(tmpDir, 'funnel-events.jsonl');
      process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
      process.env._TEST_FUNNEL_LEDGER_PATH = funnelPath;
      process.env._TEST_REVENUE_LEDGER_PATH = path.join(tmpDir, 'revenue-events.jsonl');
      process.env._TEST_API_KEYS_PATH = path.join(tmpDir, 'api-keys.json');
      process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH = path.join(tmpDir, 'local-sessions.json');
      process.env.THUMBGATE_OWNER_EMAILS = 'owner@company.example';

      delete require.cache[require.resolve('../scripts/billing')];
      const billing = require('../scripts/billing');

      const entries = [
        // 1. Real external human session (must be counted)
        {
          timestamp: '2026-11-12T00:08:29.000Z',
          stage: 'acquisition',
          event: 'checkout_session_created',
          traceId: 'checkout_real_human_1',
          visitorId: 'visitor_real_human_1',
          acquisitionId: 'acq_real_human_1',
          metadata: {
            source: 'dashboard_demo',
            ctaId: 'dashboard_demo_pro',
            planId: 'pro',
            billingCycle: 'monthly',
          },
        },
        // 2. Internal audit / consent_probe session (must be excluded)
        {
          timestamp: '2026-11-11T17:26:41.000Z',
          stage: 'acquisition',
          event: 'checkout_session_created',
          installId: 'consent_probe',
          traceId: 'checkout_probe_1',
          metadata: {
            source: 'internal_audit',
            planId: 'pro',
          },
        },
        // 3. Configured owner email session (must be excluded)
        {
          timestamp: '2026-11-10T12:00:00.000Z',
          stage: 'acquisition',
          event: 'checkout_session_created',
          traceId: 'checkout_owner_1',
          metadata: {
            source: 'website',
            customerEmail: 'owner@company.example',
            planId: 'pro',
          },
        },
        // 4 & 5. Rapid multi-CTA agent sweep 2 seconds apart (must be excluded)
        {
          timestamp: '2026-11-12T18:34:02.000Z',
          stage: 'acquisition',
          event: 'checkout_session_created',
          traceId: 'checkout_sweep_a',
          acquisitionId: 'acq_sweep_a',
          metadata: {
            source: 'website',
            ctaId: 'homepage_pro_buy',
            planId: 'pro',
            billingCycle: 'monthly',
          },
        },
        {
          timestamp: '2026-11-12T18:34:04.000Z',
          stage: 'acquisition',
          event: 'checkout_session_created',
          traceId: 'checkout_sweep_b',
          acquisitionId: 'acq_sweep_b',
          metadata: {
            source: 'dashboard_demo',
            ctaId: 'dashboard_demo_pro',
            planId: 'pro',
            billingCycle: 'monthly',
          },
        },
      ];

      fs.writeFileSync(funnelPath, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);

      const summary = billing.getBillingSummary({
        window: '30d',
        timeZone: 'UTC',
        now: '2026-11-12T20:00:00.000Z',
      });

      assert.equal(summary.funnel.stageCounts.acquisition, 1);
      assert.equal(summary.funnel.eventCounts['acquisition:checkout_session_created'], 1);
      assert.equal(summary.funnel.uniqueAcquisitionLeads, 1);
      assert.equal(summary.funnel.excludedOperatorAcquisitionEvents, 4);
      assert.equal(summary.signups.total, 1);
      assert.equal(summary.signups.uniqueLeads, 1);
      assert.equal(summary.signups.bySource.dashboard_demo, 1);
      assert.equal(summary.operatorGeneratedAcquisition.totalEvents, 4);
      assert.equal(summary.operatorGeneratedAcquisition.uniqueLeads, 4);
    } finally {
      for (const [key, val] of [
        ['THUMBGATE_FEEDBACK_DIR', saved.feedbackDir],
        ['_TEST_FUNNEL_LEDGER_PATH', saved.funnelPath],
        ['_TEST_REVENUE_LEDGER_PATH', saved.revenuePath],
        ['_TEST_API_KEYS_PATH', saved.keysPath],
        ['_TEST_LOCAL_CHECKOUT_SESSIONS_PATH', saved.sessionsPath],
        ['THUMBGATE_OWNER_EMAILS', saved.ownerEmails],
      ]) {
        if (val === undefined) delete process.env[key];
        else process.env[key] = val;
      }
      delete require.cache[require.resolve('../scripts/billing')];
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
