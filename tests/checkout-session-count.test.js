'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { classifySession, countSessions, listSessions, parseArgs } = require('../scripts/checkout-session-count');

const OWNERS = ['owner@example.test'];
const session = (overrides = {}) => ({ id: 'cs_fake', status: 'expired', payment_status: 'unpaid', success_url: 'https://thumbgate.ai/success', metadata: {}, ...overrides });

test('only a browser user agent counts as a real start', () => {
  assert.equal(classifySession(session({ metadata: { uaClass: 'browser' } }), { ownerEmails: OWNERS }), 'human');
  assert.equal(classifySession(session({ metadata: { uaClass: 'bot' } }), { ownerEmails: OWNERS }), 'bot');
  assert.equal(classifySession(session({ metadata: { uaClass: 'unknown' } }), { ownerEmails: OWNERS }), 'unknownUa');
  assert.equal(classifySession(session({ metadata: {} }), { ownerEmails: OWNERS }), 'unclassified');
  assert.equal(classifySession(session({ metadata: undefined }), { ownerEmails: OWNERS }), 'unclassified');
});

test('owner and internal-audit sessions are excluded even from a browser', () => {
  assert.equal(classifySession(session({ customer_email: 'Owner@Example.test', metadata: { uaClass: 'browser' } }), { ownerEmails: OWNERS }), 'internal');
  assert.equal(classifySession(session({ customer_details: { email: 'owner@example.test' }, metadata: { uaClass: 'browser' } }), { ownerEmails: OWNERS }), 'internal');
  assert.equal(classifySession(session({ metadata: { uaClass: 'browser', source: 'internal_audit' } }), { ownerEmails: OWNERS }), 'internal');
});

test('the count separates real browsers from crawler-era sessions and reports both', () => {
  const sessions = [
    ...Array.from({ length: 5 }, () => session({ metadata: {} })),
    session({ metadata: { uaClass: 'bot' } }),
    session({ metadata: { uaClass: 'unknown' } }),
    session({ customer_email: 'owner@example.test', metadata: { uaClass: 'browser' } }),
    session({ metadata: { uaClass: 'browser' } }),
    session({ metadata: { uaClass: 'browser' }, status: 'complete', payment_status: 'paid' }),
    session({ metadata: { uaClass: 'browser' }, status: 'complete', payment_status: 'no_payment_required' }),
  ];
  assert.deepEqual(countSessions(sessions, { ownerEmails: OWNERS }), {
    started: 11,
    nonCrawlerStarted: 3,
    nonCrawlerCompleted: 2,
    nonCrawlerPaid: 1,
    completedAll: 2,
    excluded: { bot: 1, unknownUa: 1, unclassified: 5, internal: 1 },
  });
});

test('an empty or missing list counts as zero, not an error', () => {
  const zero = { started: 0, nonCrawlerStarted: 0, nonCrawlerCompleted: 0, nonCrawlerPaid: 0, completedAll: 0, excluded: { bot: 0, unknownUa: 0, unclassified: 0, internal: 0 } };
  assert.deepEqual(countSessions([], { ownerEmails: [] }), zero);
  assert.deepEqual(countSessions(undefined, { ownerEmails: [] }), zero);
});

test('listSessions asks Stripe for the window and keeps only this product, with no live call', async () => {
  const calls = [];
  const fakeStripe = {
    checkout: {
      sessions: {
        list(params) {
          calls.push(params);
          return (async function* rows() {
            yield session({ success_url: 'https://thumbgate.ai/success?session_id={CHECKOUT_SESSION_ID}' });
            yield session({ success_url: 'https://other.example/success' });
          }());
        },
      },
    },
  };
  const nowMs = Date.parse('2026-11-19T12:00:00Z');
  const rows = await listSessions({ days: 7, stripe: fakeStripe, nowMs });
  assert.equal(rows.length, 1);
  assert.equal(calls[0].created.gte, Math.floor(nowMs / 1000) - 7 * 86400);
});

test('parseArgs reads --days and --json', () => {
  assert.deepEqual(parseArgs([]), { days: 7, json: false });
  assert.deepEqual(parseArgs(['--days', '14', '--json']), { days: 14, json: true });
});
