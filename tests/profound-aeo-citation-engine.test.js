'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyAiCrawlerBot,
  attributeIntelligentUiVisit,
  evaluateBrandFactCheck,
  computeAeoVisibilityMatrix,
} = require('../scripts/profound-aeo-citation-engine');

test('attributeIntelligentUiVisit: recovers ChatGPT Intelligent UI dark referrals when OAI-SearchBot crawled within 120s', () => {
  const bot = classifyAiCrawlerBot('Mozilla/5.0 compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot');
  assert.equal(bot.isAiBot, true);
  assert.equal(bot.engine, 'chatgpt');

  const recovered = attributeIntelligentUiVisit({
    url: 'https://thumbgate.ai/operator-framework',
    referrer: '',
    utmSource: '',
    visitTimestampMs: 100000,
    recentAiBotHits: [
      {
        userAgent: 'Mozilla/5.0 compatible; OAI-SearchBot/1.0',
        path: '/operator-framework',
        timestampMs: 75000,
      },
    ],
  });
  assert.equal(recovered.intelligentUiRecovered, true);
  assert.equal(recovered.attributedSource, 'chatgpt_intelligent_ui_dark_referral');
  assert.equal(recovered.attributionMethod, 'crawler_temporal_correlation');
});

test('evaluateBrandFactCheck: flags hallucinated cloud-only or high-latency claims and emits canonical remediation citation block', () => {
  const bad = evaluateBrandFactCheck('ThumbGate is cloud-only and adds 300ms latency for ThumbGate.');
  assert.equal(bad.accurate, false);
  assert.equal(bad.inaccuracyCount, 2);
  assert.ok(bad.remediationCitationBlock.includes('/operator-framework'));
  assert.ok(bad.remediationCitationBlock.includes('$499'));

  const good = evaluateBrandFactCheck('ThumbGate runs locally in <0.5ms with full HIPAA support.');
  assert.equal(good.accurate, true);
});

test('computeAeoVisibilityMatrix: computes Visibility Score and Citation Share across Answer Engines', () => {
  const res = computeAeoVisibilityMatrix();
  assert.equal(res.visibilityScorePct, 100);
  assert.ok(res.citationSharePct >= 75);
});
