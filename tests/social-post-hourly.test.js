const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const os = require('node:os');
const fs = require('node:fs');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-sph-'));
// Force zero-activity stats so the suppression path is exercised.
process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
test.after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

const {
  DAILY_ANGLES,
  STATS_FALLBACK_CHAIN,
  generatePost,
  handlePostFailure,
  isCliEntrypoint,
  isNonFatalPostFailure,
  pickStatsFallbackAngle,
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

// Zero-stats Bluesky-disaster regression guard (2026-04-21): the CEO flagged
// a public Bluesky post reading "This week ThumbGate blocked 0 mistakes,
// saving ~0 hours. Pre-action gates > post-mortem fixes." — the worst
// possible advertisement for a "pre-action gate" product. Under zero-
// activity stats, the 'stats' and default branches MUST pick an evergreen
// fallback angle, NOT emit the raw post text.
test('stats angle falls back to an evergreen angle when there is no activity', () => {
  const content = generatePost('stats');
  assert.ok(
    !/blocked 0 mistakes/i.test(content),
    `stats angle must not publish "blocked 0 mistakes" in a zero-activity window; got:\n${content}`,
  );
  assert.ok(
    !/saving ~0 hours/i.test(content),
    `stats angle must not publish "saving ~0 hours" in a zero-activity window; got:\n${content}`,
  );
});

test('unknown angles also fall back to evergreen angle on zero activity', () => {
  const content = generatePost('this-angle-does-not-exist');
  assert.ok(!/blocked 0 mistakes/i.test(content));
  assert.ok(!/saving ~0 hours/i.test(content));
});

test('pickStatsFallbackAngle returns only evergreen angles with no dynamic zeros', () => {
  for (const angle of STATS_FALLBACK_CHAIN) {
    assert.ok(DAILY_ANGLES.includes(angle), `${angle} must be a real angle`);
    const content = generatePost(angle);
    assert.ok(!/\b0 mistakes\b/i.test(content));
    assert.ok(!/saving ~0 hours/i.test(content));
  }
  const picked = pickStatsFallbackAngle();
  assert.ok(STATS_FALLBACK_CHAIN.includes(picked));
});

// Funnel-attribution regression guard (2026-04-21): every daily post that
// ships a CTA link must route traffic through thumbgate-production so the
// funnel ledger (scripts/funnel/*) can capture view → install → paid. An
// earlier variant routed all CTAs at github.com only, producing 0 funnel
// events across 404 published posts. Do not regress.
test('every angle with a CTA links to thumbgate-production, not only github', () => {
  const ctaAngles = ['horror-story', 'tip', 'product-demo'];
  const landingDomain = 'thumbgate.ai';

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
