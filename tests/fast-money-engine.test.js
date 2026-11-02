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
  computeTrueOddsDealScore,
  buildIntelligenceConnectorActivation,
  evaluateIntelligenceComDealRoomEngine,
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

test('evaluateIntelligenceComDealRoomEngine activates Jeremy Kang Connector at $0 spend and scores C[i] True Odds buckets', () => {
  assert.throws(
    () => buildIntelligenceConnectorActivation({ outboundCashSpendUsd: 5 }),
    /Zero Outbound Spend Mandate violation/
  );

  const dealRoom = evaluateIntelligenceComDealRoomEngine({
    pendingConnectors: ['Jeremy Kang'],
    checkoutStarts30d: 75,
    stripeConfirms30d: 41,
    cancelPageViews30d: 30,
    paidOrders30d: 0,
  });
  assert.equal(dealRoom.ok, true);
  assert.equal(dealRoom.outboundCashSpendUsd, 0);
  assert.equal(dealRoom.connectorActivation.connectorName, 'Jeremy Kang');
  assert.equal(dealRoom.connectorActivation.partnerRevSharePct, 50);
  assert.deepEqual(dealRoom.connectorActivation.slopViolations, []);
  assert.equal(dealRoom.connectorActivation.gmailNoiseFilterFix.removeLabel, 'acl/noise');
  assert.equal(dealRoom.virtualDealRoomSummary.improvingOddsCount, 1);
  assert.equal(dealRoom.virtualDealRoomSummary.slippedDealsCount, 1);
  assert.equal(dealRoom.virtualDealRoomSummary.dealsWithImprovingOdds[0].targetOfferPriceUsd, 499);
  assert.equal(dealRoom.virtualDealRoomSummary.dealsThatSlipped[0].targetOfferPriceUsd, 49);

  const slipped = computeTrueOddsDealScore({
    cancelPageViewed: true,
    previousTrueOddsPct: 45,
  });
  assert.equal(slipped.bucket, 'slipped_this_week');
  assert.equal(slipped.targetOfferPriceUsd, 49);
});

test('evaluateRemembersEverythingWorkflowEngine (tSBx5l9VFwE): enforces hyper-specific North Star 1-liner, 3-line weekly shipping cadence, objection role-play, single weekly coaching insight, and 15m/day rule', () => {
  const { evaluateRemembersEverythingWorkflowEngine } = require('../scripts/fast-money-engine');
  const res = evaluateRemembersEverythingWorkflowEngine({
    coachingInsightsRequested: 10, // should still clamp to 1 actionable insight
    dailyPracticeMinutes: 15,
    originStoryHumanWritten: true,
    outboundCashSpendUsd: 0,
  });
  assert.equal(res.ok, true);
  assert.equal(res.productValidation.linesCount, 3);
  assert.ok(res.productValidation.northStarOneLiner.includes('ThumbGate is the <0.5ms PreToolUse security firewall'));
  assert.ok(!/real estate|tax-deed/i.test(res.productValidation.northStarOneLiner));
  assert.equal(res.salesAndMeetingWorkflows.weeklyCoachingInsightsCount, 1);
  assert.equal(res.salesAndMeetingWorkflows.recommendedOfferUrl, 'https://thumbgate.ai/go/bundle-49');
  assert.equal(res.personalProductivityAndAiConfig.fifteenMinutesADayRule.dailyPracticeMinutes, 15);
  assert.equal(res.personalProductivityAndAiConfig.originStoryGovernance.originStoryHumanWritten, true);
});

test('evaluateWestMonroeSlownessTaxAndSpeedPlan (why-speed-matters): quantifies 1%-5% ARR Slowness Tax, enforces 7 Ways to Work Faster, and blocks AI redecoration theater', () => {
  const { evaluateWestMonroeSlownessTaxAndSpeedPlan } = require('../scripts/fast-money-engine');
  const plan = evaluateWestMonroeSlownessTaxAndSpeedPlan({
    annualTargetArrUsd: 1_000_000,
    singleAccountableOwner: 'Igor Ganapolsky',
    approvalChoices: ['approve', 'revise', 'escalate'],
    routineDecisionSlaHours: 24,
    shadowSystemsCount: 0,
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.slownessTaxDiagnosis.revenueAtRiskRangeUsd, [10000, 50000]);
  assert.equal(plan.aiEnterpriseRewiring.sixLeaderPatterns.length, 6);
  assert.equal(plan.aiEnterpriseRewiring.sixCapabilityPillars.length, 6);

  const redecorated = evaluateWestMonroeSlownessTaxAndSpeedPlan({
    shadowSystemsCount: 2,
    aiTransformationMode: 'redecorate_wallpaper',
  });
  assert.equal(redecorated.ok, false);
  assert.ok(redecorated.issues.includes('rework_tax:multiple_versions_of_truth_cost_10_to_25pct_weekly_time'));
  assert.ok(
    redecorated.issues.includes('ai_theater:redecorating_with_disconnected_chatbots_instead_of_rewiring_workflows')
  );
});

test('evaluateResearchRabbitRevenueEngine (app.researchrabbit.ai): activates Google SSO citation-graph outreach across 2025-2026 AI agent guardrail papers at $0 spend', () => {
  const fastMoney = require('../scripts/fast-money-engine');
  const res = fastMoney.evaluateResearchRabbitRevenueEngine();
  assert.equal(res.ok, true);
  assert.equal(res.accountEmail, 'iganapolsky@gmail.com');
  assert.equal(res.collectionName, 'ThumbGate AI Agent Guardrails');
  assert.equal(res.outboundCashSpendUsd, 0);
  assert.equal(res.savedSeedPapersCount, 5);
  assert.ok(res.outreachMessages[0].citationGroundedDm.includes('SafeAgent'));
  assert.ok(res.outreachMessages[0].citationGroundedDm.includes('https://thumbgate.ai/go/bundle-49'));

  const nonZeroSpend = fastMoney.evaluateResearchRabbitRevenueEngine({ outboundCashSpendUsd: 25 });
  assert.equal(nonZeroSpend.ok, false);
  assert.ok(nonZeroSpend.issues.includes('outbound_cash_spend_must_remain_zero'));
});

test('buildLinkedInAndTikTokViralMonetizationPack & discoverLiveViralOpportunities generate attributed LinkedIn, TikTok, and Hacker News packs at $0 spend', async () => {
  const {
    buildLinkedInAndTikTokViralMonetizationPack,
    discoverLiveViralOpportunities,
  } = require('../scripts/fast-money-engine');

  const pack = buildLinkedInAndTikTokViralMonetizationPack({
    appOrigin: 'https://thumbgate.ai',
    campaign: 'nov2026_viral',
    creator: 'iganapolsky',
    outboundCashSpendUsd: 0,
  });
  assert.equal(pack.ok, true);
  assert.equal(pack.outboundCashSpendUsd, 0);
  assert.equal(pack.linkedin.carouselSlidesCount, 7);
  assert.ok(pack.linkedin.shareIntentUrl.includes('linkedin.com/sharing/share-offsite'));
  assert.equal(pack.tiktok.scripts.length, 3);

  const radar = await discoverLiveViralOpportunities({
    fetchLiveHn: false,
    outboundCashSpendUsd: 0,
  });
  assert.equal(radar.ok, true);
  assert.equal(radar.outboundCashSpendUsd, 0);
  assert.ok(radar.viralChannels.length >= 6);
  assert.equal(radar.viralChannels[0].channelId, 'hackernews');
  assert.ok(radar.showHnLaunch.submitUrl.includes('utm_source%3Dhackernews'));
});
