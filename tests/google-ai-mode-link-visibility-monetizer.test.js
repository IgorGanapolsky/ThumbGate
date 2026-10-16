'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  scoreSectionForGoogleAiModeLinks,
  buildGoogleAiModeMonetizedArticle,
} = require('../scripts/google-ai-mode-link-visibility-monetizer');

test('buildGoogleAiModeMonetizedArticle: achieves 5/5 (1.0) Google AI Mode link-visibility score with JSON-LD creator sameAs and Official Task Block', () => {
  const pkg = buildGoogleAiModeMonetizedArticle();
  assert.equal(pkg.audit.score, 1.0);
  assert.equal(pkg.audit.passedCount, 5);
  assert.equal(pkg.audit.readyForTopInlineLink, true);
  assert.equal(pkg.audit.readyForOfficialSiteBlock, true);
  assert.equal(pkg.jsonLd['@graph'].length, 2);
});

test('scoreSectionForGoogleAiModeLinks: penalizes dangling pointers and missing early inline anchors', () => {
  const weak = scoreSectionForGoogleAiModeLinks({
    heading: 'Overview',
    body: 'As mentioned above, the latency values are shown in the table below. This tool does it well for teams.',
    meta: {},
  });
  assert.equal(weak.checks.earlyInlineAnchor, false);
  assert.equal(weak.checks.selfContainedNoDanglingPointers, false);
  assert.equal(weak.readyForTopInlineLink, false);
});
