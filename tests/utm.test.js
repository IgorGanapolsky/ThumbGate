const test = require('node:test');
const assert = require('node:assert/strict');
const { buildUTMLink } = require('../scripts/social-analytics/utm');
test('buildUTMLink adds utm params', () => {
  const r = buildUTMLink('https://example.com', { source: 'twitter', campaign: 'launch' });
  assert.ok(r.includes('utm_source=twitter'));
  assert.ok(r.includes('utm_campaign=launch'));
});
test('buildUTMLink requires source', () => {
  assert.throws(() => buildUTMLink('https://example.com', {}), /source/i);
});
test('buildUTMLink works with instagram source', () => {
  const r = buildUTMLink('https://example.com', { source: 'instagram', campaign: 'test' });
  assert.ok(r.includes('utm_source=instagram'));
});
