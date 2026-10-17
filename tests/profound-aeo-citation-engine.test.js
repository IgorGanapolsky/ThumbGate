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
