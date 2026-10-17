'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyAiCrawlerBot,
  attributeIntelligentUiVisit,
  evaluateBrandFactCheck,
  computeAeoVisibilityMatrix,
} = require('../scripts/profound-aeo-citation-engine');

test('attributeIntelligentUiVisit: recovers ChatGPT Intelligent UI dark referrals only for preceding referral-eligible crawls and exact referrer hosts', () => {
  const bot = classifyAiCrawlerBot('Mozilla/5.0 compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot');
  assert.equal(bot.isAiBot, true);
  assert.equal(bot.referralEligible, true);
  assert.equal(bot.engine, 'chatgpt');

  // Training crawler GPTBot is NOT referral-eligible
  const trainingBot = classifyAiCrawlerBot('Mozilla/5.0 compatible; GPTBot/1.0');
  assert.equal(trainingBot.referralEligible, false);

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

  // Crawl occurring AFTER visit must NOT be attributed
  const postCrawl = attributeIntelligentUiVisit({
    url: 'https://thumbgate.ai/operator-framework',
    visitTimestampMs: 50000,
    recentAiBotHits: [
      { userAgent: 'Mozilla/5.0 compatible; OAI-SearchBot/1.0', path: '/operator-framework', timestampMs: 75000 },
    ],
  });
  assert.equal(postCrawl.intelligentUiRecovered, false);
  assert.equal(postCrawl.attributedSource, 'direct');

  // Spoofed referrer host https://notchatgpt.com/page must NOT match chatgpt.com
  const spoofedRef = attributeIntelligentUiVisit({
    url: 'https://thumbgate.ai/operator-framework',
    referrer: 'https://notchatgpt.com/page',
  });
  assert.equal(spoofedRef.attributedSource, 'direct');
});

test('evaluateBrandFactCheck: respects negation and flags inaccurate latency or offer pricing claims', () => {
  const bad = evaluateBrandFactCheck('ThumbGate is cloud-only, adds 200ms latency, and the Sprint Diagnostic costs $999.');
  assert.equal(bad.accurate, false);
  assert.equal(bad.inaccuracyCount, 3);

  const negatedGood = evaluateBrandFactCheck('ThumbGate is not cloud-only and runs locally in <0.5ms for $499.');
  assert.equal(negatedGood.accurate, true);
});

test('computeAeoVisibilityMatrix: returns empty metrics for [] and full Topics x Competitors x Engines breakdown for samples', () => {
  const empty = computeAeoVisibilityMatrix([]);
  assert.equal(empty.totalPromptsEvaluated, 0);
  assert.equal(empty.visibilityScorePct, 0);

  const demo = computeAeoVisibilityMatrix();
  assert.equal(demo.visibilityScorePct, 100);
  assert.ok(demo.byEngine.claude);
  assert.ok(demo.competitorMentions.ThumbGate >= 4);
});


const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  SUPPORTED_CHANNELS,
  retrieveGraphRagEvidenceForQuery,
  selectOptimalChannelOfferArm,
  composeOmnichannelPostOrReply,
  recordOmnichannelAttestation,
  verifyOmnichannelAttestationLedger,
} = require('../scripts/profound-aeo-citation-engine');

test('Omnichannel ML + 3-Tier Graph RAG + SHA-256 Attestation Ledger across LinkedIn, Reddit, X, Skool, ZyVOP, and HackerNews', () => {
  const rag = retrieveGraphRagEvidenceForQuery('OpenRouter Armor HIPAA ZDR local fallback');
  assert.ok(rag.tier1Anchors.includes('node:openrouter_armor_zdr_hipaa'));
  const ml = selectOptimalChannelOfferArm({ channel: 'skool', query: 'collaborate on agency client builds' });
  assert.equal(ml.chosenArm.id, 'agency_partner_30pct');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-omni-'));
  try {
    const ledgerPath = path.join(tmpDir, 'attestation.jsonl');
    for (const ch of SUPPORTED_CHANNELS) {
      const msg = composeOmnichannelPostOrReply({ channel: ch, targetUrl: `https://${ch}.example.com/1`, threadTitleOrText: 'agent retry loop' });
      recordOmnichannelAttestation(msg, ledgerPath);
    }
    const ver = verifyOmnichannelAttestationLedger(ledgerPath);
    assert.equal(ver.valid, true);
    assert.equal(ver.totalEntries, 6);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
