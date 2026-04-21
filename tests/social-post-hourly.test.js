const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  DAILY_ANGLES,
  generatePost,
  handlePostFailure,
  isCliEntrypoint,
  isNonFatalPostFailure,
  runCli,
} = require('../scripts/social-post-hourly');
const { ZernioQuotaError } = require('../scripts/social-analytics/publishers/zernio');

function withPatchedConsole(method, fn) {
  const original = console[method];
  const calls = [];
  console[method] = (...args) => calls.push(args);
  try {
    const result = fn(calls);
    if (result && typeof result.then === 'function') {
      return result.finally(() => {
        console[method] = original;
      });
    }
    console[method] = original;
    return result;
  } catch (err) {
    console[method] = original;
    throw err;
  }
}

test('daily social poster treats Zernio quota exhaustion as a controlled skip', () => {
  const error = new ZernioQuotaError('Post limit reached', {
    billingPeriod: 'monthly',
    current: 120,
    limit: 120,
    planName: 'Build',
    status: 403,
  });

  assert.equal(isNonFatalPostFailure(error), true);
});

test('daily social poster still fails on non-quota publisher errors', () => {
  assert.equal(isNonFatalPostFailure(new Error('ZERNIO_API_KEY environment variable is required')), false);
  assert.equal(isNonFatalPostFailure(new Error('Zernio API 500 for POST /posts')), false);
});

test('daily social poster logs quota exhaustion as non-fatal', () => {
  const error = new ZernioQuotaError('Post limit reached', { status: 403 });

  withPatchedConsole('warn', (calls) => {
    assert.equal(handlePostFailure(error), 0);
    assert.equal(calls.length, 2);
    assert.match(calls[0][0], /Skipped: Post limit reached/);
    assert.match(calls[1][0], /controlled skip/);
  });
});

test('daily social poster reports fatal publisher errors with exit code one', () => {
  withPatchedConsole('error', (calls) => {
    assert.equal(handlePostFailure(new Error('Zernio API 500 for POST /posts')), 1);
    assert.deepEqual(calls[0], ['[daily-post] Fatal:', 'Zernio API 500 for POST /posts']);
  });
});

test('daily social poster CLI wrapper exits only for fatal failures', async () => {
  const quotaError = new ZernioQuotaError('Post limit reached', { status: 403 });
  const exitCodes = [];

  await withPatchedConsole('warn', () => runCli({
    exit: (code) => exitCodes.push(code),
    run: async () => {
      throw quotaError;
    },
  }));

  await withPatchedConsole('error', () => runCli({
    exit: (code) => exitCodes.push(code),
    run: async () => {
      throw new Error('Zernio API 500 for POST /posts');
    },
  }));

  assert.deepEqual(exitCodes, [1]);
});

test('daily social poster detects its CLI entrypoint by filename', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'social-post-hourly.js');

  assert.equal(isCliEntrypoint({ filename: scriptPath }), true);
  assert.equal(isCliEntrypoint({ filename: __filename }), false);
  assert.equal(isCliEntrypoint(null), false);
});

// Funnel-attribution regression guard (2026-04-21): every daily post that
// ships a CTA link must route traffic through thumbgate-production so the
// funnel ledger (scripts/funnel/*) can capture view → install → paid. An
// earlier variant routed all CTAs at github.com only, producing 0 funnel
// events across 404 published posts. Do not regress.
test('every angle with a CTA links to thumbgate-production, not only github', () => {
  const ctaAngles = ['horror-story', 'tip', 'product-demo'];
  const landingDomain = 'thumbgate-production.up.railway.app';

  for (const angle of DAILY_ANGLES) {
    const content = generatePost(angle);
    // Every angle known to contain a CTA link must reach the tracked domain.
    if (ctaAngles.includes(angle)) {
      assert.ok(
        content.includes(landingDomain),
        `angle "${angle}" must include ${landingDomain} for funnel attribution; got:\n${content}`
      );
    }
    // No angle should emit a github.com link as the only outbound destination.
    const hasGithub = content.includes('github.com/IgorGanapolsky/ThumbGate');
    const hasLanding = content.includes(landingDomain);
    if (hasGithub) {
      assert.ok(
        hasLanding,
        `angle "${angle}" links to github.com without also linking to the tracked landing page; add a ${landingDomain} CTA:\n${content}`
      );
    }
  }
});
