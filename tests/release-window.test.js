'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateReleaseWindow,
  readInt,
  main,
  DEFAULT_MAX_UNRELEASED_DAYS,
} = require('../scripts/release-window');

const DAY = 86400;
const NOW = 1_752_000_000; // fixed clock; the unit under test must never read the wall clock

const base = {
  shippedChanges: 5,
  pendingChangesets: 9,
  lastTagTimestamp: NOW - 2 * DAY,
  nowTimestamp: NOW,
};

test('no shipped changes: a no-op is always fine', () => {
  const v = evaluateReleaseWindow({ ...base, shippedChanges: 0, pendingChangesets: 0 });
  assert.equal(v.ok, true);
});

test('shipped changes with no changeset: fails, as it did before this change', () => {
  const v = evaluateReleaseWindow({ ...base, pendingChangesets: 0 });
  assert.equal(v.ok, false);
  assert.match(v.reason, /Silent no-op/);
});

test('shipped changes with a fresh changeset: exempt, release is plausibly imminent', () => {
  const v = evaluateReleaseWindow({ ...base, lastTagTimestamp: NOW - 2 * DAY });
  assert.equal(v.ok, true);
  assert.match(v.reason, /Release-audited/);
});

test('exemption expires: a changeset stops excusing an overdue release', () => {
  const v = evaluateReleaseWindow({ ...base, lastTagTimestamp: NOW - 30 * DAY });
  assert.equal(v.ok, false);
  assert.match(v.reason, /Release overdue/);
  assert.match(v.reason, /not on npm/);
  assert.equal(v.ageDays, 30);
});

test('boundary: exactly at the limit is still exempt; one day past is not', () => {
  const at = evaluateReleaseWindow({
    ...base,
    lastTagTimestamp: NOW - DEFAULT_MAX_UNRELEASED_DAYS * DAY,
  });
  assert.equal(at.ok, true, 'exactly at the limit must not fail');

  const past = evaluateReleaseWindow({
    ...base,
    lastTagTimestamp: NOW - (DEFAULT_MAX_UNRELEASED_DAYS + 1) * DAY,
  });
  assert.equal(past.ok, false, 'one day past the limit must fail');
});

test('maxUnreleasedDays is configurable', () => {
  const v = evaluateReleaseWindow({
    ...base,
    lastTagTimestamp: NOW - 10 * DAY,
    maxUnreleasedDays: 30,
  });
  assert.equal(v.ok, true);
});

// Regression: the exact state of the 2026-07-09 incident.
// PR #2807 fixed the deny-network-egress host-boundary bypass and merged as 811635b.
// `Publish to NPM` reported success while publishing nothing, because 9 pending changesets
// (incl. deny-network-egress-host-boundary.md) excused the no-op. npm kept serving the
// vulnerable pattern. Under the old rule this passed at any age.
test('regression 2026-07-09: fix merged, 9 changesets pending, release long overdue -> must fail', () => {
  const lastRelease = Date.parse('2026-07-08T20:47:35Z') / 1000; // adfbcec8 release: 1.27.20
  const twoWeeksLater = lastRelease + 14 * DAY;

  const v = evaluateReleaseWindow({
    shippedChanges: 12,
    pendingChangesets: 9,
    lastTagTimestamp: lastRelease,
    nowTimestamp: twoWeeksLater,
  });

  assert.equal(v.ok, false, 'a security fix unshipped for two weeks must not pass silently');
  assert.match(v.reason, /Cut a release PR/);
});

test('same-day merge is still exempt: this must not break normal development', () => {
  const lastRelease = Date.parse('2026-07-08T20:47:35Z') / 1000;
  const v = evaluateReleaseWindow({
    shippedChanges: 12,
    pendingChangesets: 9,
    lastTagTimestamp: lastRelease,
    nowTimestamp: lastRelease + 4 * 3600,
  });
  assert.equal(v.ok, true, 'merging hours after a release must not fail CI');
});

// --- readInt ---------------------------------------------------------------------------------

test('readInt parses an integer from the environment', () => {
  process.env.RW_TEST_INT = '42';
  try {
    assert.equal(readInt('RW_TEST_INT'), 42);
  } finally {
    delete process.env.RW_TEST_INT;
  }
});

test('readInt falls back when the variable is unset or empty', () => {
  delete process.env.RW_TEST_MISSING;
  assert.equal(readInt('RW_TEST_MISSING', 7), 7);
  process.env.RW_TEST_EMPTY = '';
  try {
    assert.equal(readInt('RW_TEST_EMPTY', 7), 7);
  } finally {
    delete process.env.RW_TEST_EMPTY;
  }
});

test('readInt throws when required and absent', () => {
  delete process.env.RW_TEST_REQUIRED;
  assert.throws(() => readInt('RW_TEST_REQUIRED'), /Missing required env RW_TEST_REQUIRED/);
});

test('readInt throws on a non-integer', () => {
  process.env.RW_TEST_BAD = 'seven';
  try {
    assert.throws(() => readInt('RW_TEST_BAD'), /not an integer/);
  } finally {
    delete process.env.RW_TEST_BAD;
  }
});

// --- main ------------------------------------------------------------------------------------

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    process.env[k] = String(v);
  }
  const lines = [];
  const realLog = console.log;
  console.log = (msg) => lines.push(String(msg));
  try {
    return { code: fn(), lines };
  } finally {
    console.log = realLog;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const NOW_S = Math.floor(Date.parse('2026-07-10T13:00:00Z') / 1000);

test('main exits 0 and emits a notice when the window is open', () => {
  const { code, lines } = withEnv(
    {
      SHIPPED_CHANGES: 12,
      PENDING_CHANGESETS: 9,
      LAST_TAG_TIMESTAMP: NOW_S - 1 * 86400,
      NOW_TIMESTAMP: NOW_S,
      MAX_UNRELEASED_DAYS: 7,
    },
    main,
  );
  assert.equal(code, 0);
  assert.match(lines.join('\n'), /^::notice::/m);
});

test('main exits 1 and emits an error when the release is overdue', () => {
  const { code, lines } = withEnv(
    {
      SHIPPED_CHANGES: 12,
      PENDING_CHANGESETS: 9,
      LAST_TAG_TIMESTAMP: NOW_S - 30 * 86400,
      NOW_TIMESTAMP: NOW_S,
      MAX_UNRELEASED_DAYS: 7,
    },
    main,
  );
  assert.equal(code, 1, 'an overdue release must fail the workflow');
  assert.match(lines.join('\n'), /^::error::.*Release overdue/m);
});

test('main honours MAX_UNRELEASED_DAYS from the environment', () => {
  const { code } = withEnv(
    {
      SHIPPED_CHANGES: 12,
      PENDING_CHANGESETS: 9,
      LAST_TAG_TIMESTAMP: NOW_S - 30 * 86400,
      NOW_TIMESTAMP: NOW_S,
      MAX_UNRELEASED_DAYS: 60,
    },
    main,
  );
  assert.equal(code, 0);
});
