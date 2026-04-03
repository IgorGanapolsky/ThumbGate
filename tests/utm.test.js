const test = require('node:test');
const assert = require('node:assert/strict');
const { buildUTMLink } = require('../scripts/social-analytics/utm');
test('adds utm params', () => { const r = buildUTMLink('https://x.com', { source: 'twitter', campaign: 'launch' }); assert.ok(r.includes('utm_source=twitter')); });
test('requires source', () => { assert.throws(() => buildUTMLink('https://x.com', {}), /source/i); });
test('instagram source', () => { assert.ok(buildUTMLink('https://x.com', { source: 'instagram', campaign: 'x' }).includes('instagram')); });
