'use strict';

// One refund policy for self-serve Pro: within 7 days of the first charge, only for a documented platform defect we
// cannot fix; after that, non-refundable except as the law requires. The checkout page, /support and /terms must say
// the same thing, and none may promise a refund "no questions asked".

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const sources = {
  checkout: plain(read('src/api/server.js')),
  support: plain(read('public/support.html')),
  terms: plain(read('public/terms.html')),
};

test('checkout, support and terms all state the 7-day documented-defect refund', () => {
  for (const [name, text] of Object.entries(sources)) {
    assert.match(text, /within 7 days of the (initial|first) charge/i, name + ' names the 7-day window');
    assert.match(text, /documented platform defect/i, name + ' names the documented-defect condition');
  }
});

test('support and terms both say renewals are non-refundable except as the law requires', () => {
  for (const name of ['support', 'terms']) assert.match(sources[name], /non-refundable except as required by law/i, name);
});

test('no page promises a refund with no questions asked', () => {
  for (const [name, text] of Object.entries(sources)) assert.doesNotMatch(text, /refund,? no questions/i, name);
});
