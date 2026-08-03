'use strict';

/**
 * Money attack matrix — structural regression lock for the never-spend class.
 *
 * Patches for individual tools (open Apollo URL, WebFetch Stripe, browser
 * description, etc.) keep leaking because each only pins the last vector.
 * This table is the source of truth: every economic tool × input surface must
 * stay detectEconomicAction=true and hard-floor deny, and free-tier/search
 * surfaces must stay non-economic. Pre-push runs this file.
 *
 * Incident class: Apollo ~$588 annual charge (2026-08).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  detectEconomicAction,
} = require('../scripts/financial-control-plane');

// Pin operator shell vars so never-spend STRICT / local financial config cannot
// flip product assertions (same class as landing-page-claims STRICT pollution).
const ORIGINAL_ENV = {
  THUMBGATE_STRICT_ENFORCEMENT: process.env.THUMBGATE_STRICT_ENFORCEMENT,
  THUMBGATE_FINANCIAL_CONFIG: process.env.THUMBGATE_FINANCIAL_CONFIG,
  THUMBGATE_FEEDBACK_DIR: process.env.THUMBGATE_FEEDBACK_DIR,
  CI: process.env.CI,
  GITHUB_ACTIONS: process.env.GITHUB_ACTIONS,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/** @type {Array<{ id: string, toolName: string, toolInput: object, economic: boolean, note?: string }>} */
const SPEND_MATRIX = [
  {
    id: 'bash-open-apollo-hash-plans',
    toolName: 'Bash',
    toolInput: { command: 'open https://app.apollo.io/#/settings/plans/upgrade' },
    economic: true,
    note: 'Apollo $588 class — hash-routed plans upgrade',
  },
  {
    id: 'bash-open-apollo-path-plans',
    toolName: 'Bash',
    toolInput: { command: 'open https://app.apollo.io/settings/plans/upgrade' },
    economic: true,
  },
  {
    id: 'bash-curl-stripe-checkout',
    toolName: 'Bash',
    toolInput: { command: 'curl -X POST https://checkout.stripe.com/c/pay/cs_test_xxx' },
    economic: true,
  },
  {
    id: 'bash-open-buy-stripe',
    toolName: 'Bash',
    toolInput: { command: 'open https://buy.stripe.com/test_xxx' },
    economic: true,
  },
  {
    id: 'bash-curl-billing-stripe',
    toolName: 'Bash',
    toolInput: { command: 'curl https://billing.stripe.com/p/session/test' },
    economic: true,
  },
  {
    id: 'webfetch-stripe-checkout-url',
    toolName: 'WebFetch',
    toolInput: { url: 'https://checkout.stripe.com/c/pay/cs_test' },
    economic: true,
  },
  {
    id: 'webfetch-apollo-plans-url',
    toolName: 'WebFetch',
    toolInput: { url: 'https://app.apollo.io/settings/plans/upgrade' },
    economic: true,
  },
  {
    id: 'webfetch-apollo-billing-uri',
    toolName: 'WebFetch',
    toolInput: { uri: 'https://app.apollo.io/#/settings/billing' },
    economic: true,
  },
  {
    id: 'browser-navigate-href-stripe',
    toolName: 'Browser',
    toolInput: { action: 'navigate', href: 'https://checkout.stripe.com/c/pay/cs_live' },
    economic: true,
  },
  {
    id: 'playwright-goto-apollo-subscription',
    toolName: 'mcp__playwright__browser_navigate',
    toolInput: { url: 'https://apollo.io/pricing/subscription' },
    economic: true,
  },
  {
    id: 'bash-subscribe-prose',
    toolName: 'Bash',
    toolInput: { command: 'stripe subscriptions create --customer cus_x --items price_x' },
    economic: true,
  },
  // Non-economic: free search / docs must not false-positive the money floor.
  {
    id: 'bash-apollo-cli-search',
    toolName: 'Bash',
    toolInput: { command: 'apollo people search --q founder' },
    economic: false,
    note: 'Free-tier Apollo search must stay non-economic',
  },
  {
    id: 'webfetch-github-billing-docs',
    toolName: 'WebFetch',
    toolInput: { url: 'https://docs.github.com/en/billing' },
    economic: false,
  },
  {
    id: 'bash-echo-checkout-narrative',
    toolName: 'Bash',
    toolInput: { command: 'echo "review the checkout flow in the design doc"' },
    economic: false,
    note: 'Narrative checkout in echo/grep must not trip execution surface',
  },
];

test('spend attack matrix: detectEconomicAction matches every tool × surface row', () => {
  const failures = [];
  for (const row of SPEND_MATRIX) {
    const actual = detectEconomicAction(row.toolName, row.toolInput);
    if (actual !== row.economic) {
      failures.push({
        id: row.id,
        expected: row.economic,
        actual,
        toolName: row.toolName,
        toolInput: row.toolInput,
        note: row.note || '',
      });
    }
  }
  assert.deepEqual(failures, [], `matrix mismatches:\n${JSON.stringify(failures, null, 2)}`);
});

test('spend attack matrix: economic rows hard-floor deny via runHardFloor', () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-spend-matrix-'));
  process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
  process.env.THUMBGATE_STRICT_ENFORCEMENT = '';
  delete process.env.THUMBGATE_FINANCIAL_CONFIG;

  try {
    delete require.cache[require.resolve('../scripts/gates-engine')];
    delete require.cache[require.resolve('../scripts/financial-control-plane')];
    const { runHardFloor } = require('../scripts/gates-engine');

    const economicRows = SPEND_MATRIX.filter((row) => row.economic);
    const failures = [];
    for (const row of economicRows) {
      const raw = runHardFloor({
        tool_name: row.toolName,
        tool_input: row.toolInput,
      });
      let decision = 'allow';
      let gate = null;
      try {
        const parsed = JSON.parse(raw || '{}');
        decision = parsed.hookSpecificOutput?.permissionDecision || 'allow';
        const reason = parsed.hookSpecificOutput?.permissionDecisionReason || '';
        const match = /\[GATE:([^\]]+)\]/.exec(reason);
        gate = match ? match[1] : null;
      } catch {
        decision = 'parse-error';
      }
      if (decision !== 'deny' || gate !== 'financial-control') {
        failures.push({
          id: row.id,
          decision,
          gate,
          toolName: row.toolName,
          toolInput: row.toolInput,
        });
      }
    }
    assert.deepEqual(failures, [], `hard-floor misses:\n${JSON.stringify(failures, null, 2)}`);
  } finally {
    restoreEnv();
    fs.rmSync(feedbackDir, { recursive: true, force: true });
    delete require.cache[require.resolve('../scripts/gates-engine')];
    delete require.cache[require.resolve('../scripts/financial-control-plane')];
  }
});

test('financial-control deny is never demoted by warn-by-default posture', () => {
  process.env.THUMBGATE_STRICT_ENFORCEMENT = '';
  try {
    delete require.cache[require.resolve('../scripts/gates-engine')];
    const { applyEnforcementPosture } = require('../scripts/gates-engine');
    const result = applyEnforcementPosture({
      decision: 'deny',
      gate: 'financial-control',
      message: 'Economic actions require authorization',
      severity: 'critical',
      reasoning: ['matrix'],
    });
    assert.equal(result.decision, 'deny');
    assert.equal(result.warnByDefault, undefined);
    assert.equal(result.gate, 'financial-control');
  } finally {
    restoreEnv();
    delete require.cache[require.resolve('../scripts/gates-engine')];
  }
});

test('financial-control deny is never demoted by free-tier daily block cap', () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-spend-cap-home-'));
  const statsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-spend-cap-stats-'));
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
  delete process.env.THUMBGATE_API_KEY;
  delete process.env.THUMBGATE_DEV_BYPASS;
  delete process.env.CI;
  delete process.env.GITHUB_ACTIONS;
  process.env.THUMBGATE_NO_TRIAL = '1';
  process.env.THUMBGATE_STRICT_ENFORCEMENT = '';

  try {
    const { FREE_TIER_DAILY_BLOCKS, isProTier } = require('../scripts/rate-limiter');
    const statsPath = path.join(statsDir, 'gate-stats.json');
    const today = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(statsPath, JSON.stringify({
      blocked: FREE_TIER_DAILY_BLOCKS,
      warned: 0,
      passed: 0,
      byGate: {},
      dailyBlocks: { [today]: FREE_TIER_DAILY_BLOCKS },
    }));

    delete require.cache[require.resolve('../scripts/rate-limiter')];
    delete require.cache[require.resolve('../scripts/gates-engine')];
    const ge = require('../scripts/gates-engine');
    ge.STATS_PATH = statsPath;

    assert.equal(isProTier(), false, 'must exercise free-tier path');

    const result = ge.applyDailyBlockCap({
      decision: 'deny',
      gate: 'financial-control',
      message: 'Economic actions require authorization',
      severity: 'critical',
      reasoning: ['matrix'],
    });
    assert.equal(result, null, 'financial-control must never receive daily-cap discount');
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    restoreEnv();
    fs.rmSync(fakeHome, { recursive: true, force: true });
    fs.rmSync(statsDir, { recursive: true, force: true });
    delete require.cache[require.resolve('../scripts/rate-limiter')];
    delete require.cache[require.resolve('../scripts/gates-engine')];
  }
});
