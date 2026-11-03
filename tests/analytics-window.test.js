'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  resolveAnalyticsWindow,
  eventOccursInWindow,
  filterEntriesForWindow,
} = require('../scripts/analytics-window');

describe('analytics-window', () => {
  it('resolveAnalyticsWindow defaults to lifetime', () => {
    const w = resolveAnalyticsWindow({});
    assert.strictEqual(w.window, 'lifetime');
    assert.strictEqual(w.bounded, false);
    assert.strictEqual(w.__kind, 'analytics_window');
  });

  it('resolveAnalyticsWindow normalizes day to today', () => {
    const w = resolveAnalyticsWindow({ window: 'day', now: '2026-03-15T12:00:00Z', timeZone: 'UTC' });
    assert.strictEqual(w.window, 'today');
    assert.strictEqual(w.bounded, true);
    assert.strictEqual(w.startLocalDate, w.endLocalDate);
  });

  it('resolveAnalyticsWindow normalizes 90-day to 90d with 89-day inclusive lookback', () => {
    const w = resolveAnalyticsWindow({ window: '90-day', now: '2026-11-02T12:00:00Z', timeZone: 'UTC' });
    assert.strictEqual(w.window, '90d');
    assert.strictEqual(w.bounded, true);
    assert.strictEqual(w.startLocalDate, '2026-08-05');
    assert.strictEqual(w.endLocalDate, '2026-11-02');
  });

  it('resolveAnalyticsWindow throws on invalid window', () => {
    assert.throws(() => resolveAnalyticsWindow({ window: 'invalid' }), /Invalid analytics window/);
  });

  it('eventOccursInWindow returns true for lifetime window', () => {
    assert.strictEqual(eventOccursInWindow('2020-01-01T00:00:00Z', { window: 'lifetime' }), true);
  });

  it('filterEntriesForWindow filters by date', () => {
    const entries = [
      { timestamp: '2026-03-15T10:00:00Z', data: 'a' },
      { timestamp: '2026-03-10T10:00:00Z', data: 'b' },
      { timestamp: '2026-01-01T10:00:00Z', data: 'c' },
    ];
    const filtered = filterEntriesForWindow(entries, {
      window: '7d',
      now: '2026-03-15T12:00:00Z',
      timeZone: 'UTC',
    });
    assert.strictEqual(filtered.length, 2);
  });
});
