const test = require('node:test');
const assert = require('node:assert/strict');
const { buildUTMLink } = require('../scripts/social-analytics/utm');
test('buildUTMLink adds utm params to URL', () => {
  const r = buildUTMLink('https://example.com', { source: 'twitter', campaign: 'launch' });
  assert.ok(r.includes('utm_source=twitter'));
  assert.ok(r.includes('utm_campaign=launch'));
});
test('buildUTMLink handles missing params', () => {
  const r = buildUTMLink('https://example.com', {});
  assert.ok(r.startsWith('https://example.com'));
});
test('buildUTMLink handles platform-specific defaults', () => {
  const r = buildUTMLink('https://example.com', { source: 'instagram' });
  assert.ok(r.includes('utm_source=instagram'));
});
