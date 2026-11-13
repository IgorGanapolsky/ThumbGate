'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmpRuntimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-brand-standards-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpRuntimeDir;
process.env.THUMBGATE_STATE_DIR = tmpRuntimeDir;

const test = require('node:test');
test.after(() => fs.rmSync(tmpRuntimeDir, { recursive: true, force: true }));
const assert = require('node:assert');
const {
  loadBrandStandards,
  detectBrandFromText,
  extractDistinctPrices,
  rewriteInIgorVoice,
  evaluateBrandStandards,
  inspectOutboundOrCreativeToolCall,
  applyBrandStandardsPretool,
  listPendingBrandRules,
  stageCandidateBrandRuleFromFeedback,
  approveCandidateBrandRule,
} = require('../scripts/brand-standards-gate');

test('Brand standards config loading and brand detection', () => {
  const config = loadBrandStandards();
  assert.ok(config && config.brands && config.rules, 'Config loads valid structure');
  assert.strictEqual(detectBrandFromText('ThumbGate local guardrail', 'ThumbGate'), 'thumbgate');
  assert.strictEqual(detectBrandFromText('Mac YOLO Safeguards stops loops', ''), 'mac-yolo');
  assert.strictEqual(detectBrandFromText('Some general copy', 'thumbgate'), 'thumbgate');
});

test('Extract distinct prices correctly', () => {
  const text = 'Get ThumbGate for $19/mo or $149/yr or $499 lifetime, or Mac YOLO for $9.99.';
  const prices = extractDistinctPrices(text);
  assert.deepStrictEqual(prices, ['$19/mo', '$149/yr', '$499', '$9.99']);
});

test('Evaluate brand standards: denies real estate / tax deed mention', () => {
  const copy = 'Grab our 5-folio Miami-Dade tax-deed property diligence packet for real estate arbitrage.';
  const result = evaluateBrandStandards(copy);
  assert.strictEqual(result.allowed, false);
  assert.ok(result.violations.some((v) => v.ruleId === 'no-real-estate-or-tax-deed'));
  assert.ok(result.message.includes('real estate'));
});

test('Evaluate brand standards: denies unverified refund / guarantee promise', () => {
  const copy = 'Try ThumbGate today with our risk-free 30-day money-back guarantee and full refund SLA credit.';
  const result = evaluateBrandStandards(copy);
  assert.strictEqual(result.allowed, false);
  assert.ok(result.violations.some((v) => v.ruleId === 'no-unverified-refund-or-guarantee'));
});

test('Evaluate brand standards: denies cross-product conflation', () => {
  const copy = 'ThumbGate users should also check out Dayglass and Mac YOLO safeguards.';
  const result = evaluateBrandStandards(copy);
  assert.strictEqual(result.allowed, false);
  assert.ok(result.violations.some((v) => v.ruleId === 'no-cross-product-conflation'));
});

test('Evaluate brand standards: denies stacked sales jargon and multiple prices', () => {
  const copy =
    'Problem: You need $49 One-Time Corporate-Expensable Rule-Pack Kit ($49, $19/mo, $499, $100 limits). ' +
    'It is a game-changer paradigm shift with zero procurement friction.';
  const result = evaluateBrandStandards(copy);
  assert.strictEqual(result.allowed, false);
  assert.ok(result.violations.some((v) => v.ruleId === 'voice-no-stacked-jargon'));
  assert.ok(result.violations.some((v) => v.ruleId === 'voice-no-line-labels'));
  assert.ok(result.violations.some((v) => v.ruleId === 'voice-single-price-per-post'));
});

test('Evaluate brand standards: passes normal ThumbGate post and rewrites bad copy', () => {
  const goodCopy = 'ThumbGate checks shell and git commands locally before they run. Install at https://thumbgate.ai for $19/mo.';
  const result = evaluateBrandStandards(goodCopy);
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.violations.length, 0);

  const badCopy = 'Problem: Real estate tax deed 7-day refund guarantee with $49 and $499 prices and Dayglass.';
  const rewrite = rewriteInIgorVoice(badCopy);
  assert.ok(typeof rewrite === 'string' && rewrite.length > 0);
  assert.ok(!rewrite.toLowerCase().includes('real estate'));
  assert.ok(!rewrite.toLowerCase().includes('refund'));
  assert.ok(!rewrite.toLowerCase().includes('dayglass'));
});

test('Adobe creative file protection: blocks overwriting original project file without saved copy', () => {
  const toolName = 'Write';
  const toolInput = { file_path: 'assets/design/hero-campaign.psd', content: 'binary data' };
  const verdict = applyBrandStandardsPretool(toolName, toolInput);
  assert.ok(verdict);
  assert.strictEqual(verdict.decision, 'deny');
  assert.strictEqual(verdict.ruleId, 'creative-no-overwrite-original');
});

test('Adobe creative file protection: allows writing to working copy and requires approval for export/publish', () => {
  const safeWrite = { file_path: 'assets/design/hero-campaign_copy.psd', content: 'binary data' };
  const writeVerdict = applyBrandStandardsPretool('Write', safeWrite);
  assert.strictEqual(writeVerdict, null);

  const exportTool = { file_path: 'assets/design/hero-campaign.psd', action: 'export' };
  const exportVerdict = applyBrandStandardsPretool('AdobePhotoshop', exportTool);
  assert.ok(exportVerdict);
  assert.strictEqual(exportVerdict.decision, 'approve');
  assert.strictEqual(exportVerdict.requiresApproval, true);
});

test('Feedback learning: stages candidate rule from negative feedback on post content', () => {
  const feedback = {
    id: 'fb_test_123',
    signal: 'negative',
    tags: ['post', 'brand'],
    context: 'LinkedIn post included "unconditional lifetime SLA credit"',
    whatWentWrong: 'Mentioned "unconditional lifetime SLA credit" which is false.',
    whatToChange: 'Never mention unconditional lifetime SLA credit.',
  };
  const staged = stageCandidateBrandRuleFromFeedback(feedback, { feedbackDir: tmpRuntimeDir });
  assert.ok(staged);
  assert.strictEqual(staged.status, 'pending_approval');
  assert.strictEqual(staged.autoApplied, false);
  assert.ok(staged.phrase.includes('unconditional lifetime SLA credit'));
});

test("Today's full LinkedIn incident post fails on real-estate, jargon, multiple prices, labels; rewrite passes", () => {
  const TODAY_LINKEDIN_POST =
    'Problem: AI coding agents are making unauthorized changes to production databases and codebases.\n' +
    'Solution: Get our $49 One-Time Corporate-Expensable Rule-Pack Kit (<$50 card limit, zero procurement friction).\n' +
    'You also get ThumbGate for $19/mo or $499 lifetime, with a risk-free 7-day refund guarantee.\n' +
    "And for Florida real estate investors bidding this week's Miami-Dade tax-deed auction, our statutory F.S. 197.552 5-Folio Pre-Bid Diligence Packet ($100) is live at https://deals.igorganapolsky.com.";

  const verdict = evaluateBrandStandards(TODAY_LINKEDIN_POST, { brand: 'thumbgate' });
  assert.strictEqual(verdict.allowed, false);

  const ruleIds = verdict.violations.map((v) => v.ruleId);
  assert.ok(ruleIds.includes('no-real-estate-or-tax-deed'), 'Must catch real estate / tax deed');
  assert.ok(ruleIds.includes('voice-no-stacked-jargon'), 'Must catch corporate-expensable / zero procurement friction');
  assert.ok(ruleIds.includes('voice-no-line-labels'), 'Must catch Problem: / Solution:');
  assert.ok(ruleIds.includes('voice-single-price-per-post'), 'Must catch multiple prices ($49, $19/mo, $499, $100)');
  assert.ok(ruleIds.includes('no-unverified-refund-or-guarantee'), 'Must catch 7-day refund guarantee');

  // Verify plain-words rewrite following post-like-igor
  const rewrite = rewriteInIgorVoice(TODAY_LINKEDIN_POST, { brand: 'thumbgate' });
  assert.ok(typeof rewrite === 'string' && rewrite.length > 0);
  assert.ok(!rewrite.includes('Problem:'), 'Rewrite must drop labels');
  assert.ok(!rewrite.includes('real estate'), 'Rewrite must drop real estate');
  assert.ok(!rewrite.includes('refund guarantee'), 'Rewrite must drop refund guarantee');
  assert.ok(!rewrite.includes('zero procurement friction'), 'Rewrite must drop jargon');

  const rewriteVerdict = evaluateBrandStandards(rewrite, { brand: 'thumbgate' });
  assert.strictEqual(rewriteVerdict.allowed, true, 'Rewrite must pass brand standards');
});

test('Integration: evaluateGates blocks outbound publish tool calls violating brand standards', () => {
  const { evaluateGates } = require('../scripts/gates-engine');

  const badToolCall = {
    command: 'node scripts/post-everywhere.js --text "Get ThumbGate with 7-day refund guarantee and zero procurement friction"',
  };
  const decision = evaluateGates('Bash', badToolCall);
  assert.ok(decision, 'Must return a decision');
  assert.strictEqual(decision.decision, 'deny');
  assert.strictEqual(decision.gate, 'brand-standards-gate');

  const goodToolCall = {
    command: 'node scripts/post-everywhere.js --text "ThumbGate checks shell and git commands locally before they run. https://thumbgate.ai"',
  };
  const goodDecision = evaluateGates('Bash', goodToolCall);
  // May be allowed or null (meaning passed through)
  assert.ok(!goodDecision || goodDecision.decision === 'allow' || goodDecision.decision !== 'deny');
});
