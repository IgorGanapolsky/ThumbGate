'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TIER_LADDER,
  ALLOWLISTED_OPENUI_CATALOG,
  evaluateFastMoneyFunnelAndTierLadder,
  generatePartnerFlipReply,
  buildFourTierCtaBlock,
  compileOpenUiLangPricingAndCarouselStream,
  generateViralCarouselDeck,
  runMakeMoneyAutonomousLoop,
} = require('../scripts/fast-money-engine');

test('evaluateFastMoneyFunnelAndTierLadder validates all 4 monetization tiers and $0 outbound spend', () => {
  const brokenFunnel = evaluateFastMoneyFunnelAndTierLadder({
    directStripeSkipStyledAsPrimary: false,
    homepageHeroRoutesToProDirect: false,
    hasUnder50CorporateExpenseBundle: false,
    dailyDraftsIncludeAllFourTiers: false,
    outboundCashSpendUsd: 25,
  });
  assert.equal(brokenFunnel.ok, false);
  assert.ok(brokenFunnel.blockers.includes('checkout_interstitial_skip_link_missing_primary_button_css'));
  assert.ok(brokenFunnel.blockers.includes('missing_49_dollar_one_time_corporate_expensable_bundle_for_subscription_averse_buyers'));
  assert.ok(brokenFunnel.blockers.includes('zero_outbound_spend_violation_they_pay_us'));

  const healthyFunnel = evaluateFastMoneyFunnelAndTierLadder();
  assert.equal(healthyFunnel.ok, true);
  assert.equal(healthyFunnel.outboundCashSpendUsd, 0);
  assert.equal(healthyFunnel.tiers.tier1Playbook.priceUsd, 9.99);
  assert.equal(healthyFunnel.tiers.tier1Playbook.url, 'https://iganapolsky.gumroad.com/l/odrkon');
  assert.equal(healthyFunnel.tiers.tier2ExpenseBundle.priceUsd, 49.0);
  assert.equal(healthyFunnel.tiers.tier2ExpenseBundle.url, 'https://iganapolsky.gumroad.com/l/vcrho');
  assert.equal(healthyFunnel.tiers.tier3FoundingOrPro.priceUsd, 149.0);
  assert.equal(healthyFunnel.tiers.tier4FdeDiagnostic.priceUsd, 499.0);
});

test('generatePartnerFlipReply enforces reciprocal-first gate, 50% net rev-share, $0 spend, and zero bot-slop', () => {
  assert.throws(
    () => generatePartnerFlipReply({ outboundCashSpendUsd: 10 }),
    /Zero Outbound Spend Mandate violation/
  );

  const reply = generatePartnerFlipReply({
    partnerName: 'Mohamed',
    partnerPublication: 'AI-Native Founder',
  });
  assert.equal(reply.ok, true);
  assert.equal(reply.outboundCashSpendUsd, 0);
  assert.equal(reply.partnerRevSharePct, 50);
  assert.equal(reply.slopViolations.length, 0);
  assert.match(reply.text, /Add mine on your side first/);
  assert.match(reply.text, /https:\/\/iganapolsky\.gumroad\.com\/l\/vcrho/);
  assert.match(reply.text, /https:\/\/thumbgate\.ai\/go\/pro-direct/);
  assert.match(reply.text, /https:\/\/thumbgate\.ai\/diagnostic/);
});

test('buildFourTierCtaBlock includes all 4 revenue tiers plus MIT CLI', () => {
  const block = buildFourTierCtaBlock();
  assert.match(block, /npx thumbgate@latest init/);
  assert.match(block, /\$9\.99 Playbook/);
  assert.match(block, /\$49 Complete Production Rule-Pack/);
  assert.match(block, /https:\/\/iganapolsky\.gumroad\.com\/l\/vcrho/);
  assert.match(block, /\$19\/mo or \$149\/yr ThumbGate Pro/);
  assert.match(block, /\$499 Enterprise/);
});

test('compileOpenUiLangPricingAndCarouselStream emits root-first catalog-bounded OpenUI Lang stream (-52.8% tokens)', () => {
  const compiled = compileOpenUiLangPricingAndCarouselStream();
  assert.equal(compiled.ok, true);
  assert.equal(compiled.rootFirst, true);
  assert.deepEqual(compiled.unknownComponents, []);
  assert.equal(compiled.tokenSavingsVsJsonPct, 52.8);
  assert.equal(compiled.contactFormTokenSavingsVsJsonPct, 67.1);
  assert.ok(compiled.usedComponents.every((c) => ALLOWLISTED_OPENUI_CATALOG.includes(c)));
});

test('generateViralCarouselDeck enforces 8-step carousel self-QA, 2 verified stat boxes per slide, and LinkedIn caption-link adaptation', () => {
  const deck = generateViralCarouselDeck({ accountVariant: 'founder_magenta' });
  assert.equal(deck.ok, true);
  assert.equal(deck.outboundCashSpendUsd, 0);
  assert.equal(deck.slidesCount, 7);
  assert.equal(deck.selfQa.overlappingElementsCount, 0);
  assert.equal(deck.selfQa.allStatsSameDayVerified, true);
  assert.equal(deck.selfQa.linkedInFinalSlideUsesCaptionLink, true);
  assert.match(deck.html, /#ff90e8/);
});

test('runMakeMoneyAutonomousLoop executes all 6 revenue stages and writes receipt at $0 outbound spend', async () => {
  const os = require('node:os');
  const path = require('node:path');
  const fs = require('node:fs');
  const tmpReceipt = path.join(os.tmpdir(), `make-money-test-${Date.now()}.json`);
  try {
    const receipt = await runMakeMoneyAutonomousLoop({
      runLiveSubprocesses: false,
      receiptPath: tmpReceipt,
    });
    assert.equal(receipt.ok, true);
    assert.equal(receipt.outboundCashSpendUsd, 0);
    assert.equal(receipt.northStarDailyTargetUsd, 100);
    assert.equal(receipt.stages.stage1Funnel.ok, true);
    assert.equal(receipt.stages.stage3ContentAndCarousel.ok, true);
    assert.equal(receipt.stages.stage4OpenUi.ok, true);
    assert.equal(receipt.stages.stage6CheckoutRecovery.verdict, 'VERIFIED');
    assert.ok(fs.existsSync(tmpReceipt));
  } finally {
    try { fs.unlinkSync(tmpReceipt); } catch {}
  }
});
