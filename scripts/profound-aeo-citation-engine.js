#!/usr/bin/env node
'use strict';

/**
 * scripts/profound-aeo-citation-engine.js
 *
 * Steals the core Answer Engine Optimization (AEO) & Attribution architectures from Profound (`tryprofound.com`):
 *   1. ChatGPT Intelligent UI Missing-UTM Attribution Recovery (`attributeIntelligentUiVisit`).
 *   2. Answer Engine `FactCheck` & Remediation Diode (`evaluateBrandFactCheck`).
 *   3. `Topics × Competitors × Engines` Visibility & Citation Share Matrix (`computeAeoVisibilityMatrix`).
 */

const PROFOUND_INTELLIGENT_UI_BENCHMARK = {
  studyDate: '2026-10-14',
  author: 'Josh Blyskal (Profound)',
  oct8TaggedSharePct: 98,
  oct9TaggedSharePct: 75,
  oct14TaggedSharePct: 66,
  oct8IntelligentUiSharePct: 2,
  oct9IntelligentUiSharePct: 26,
  oct14IntelligentUiSharePct: 35,
  untaggedCitationAnswerSharePct: 34,
};

/**
 * Answer-engine search/user fetchers eligible for referral correlation (excludes training crawlers
 * such as GPTBot, generic GoogleOther, or Google-Extended robots token).
 */
const AI_ANSWER_ENGINE_BOTS = [
  { pattern: /OAI-SearchBot|ChatGPT-User/i, engine: 'chatgpt', family: 'OpenAI', referralEligible: true },
  { pattern: /PerplexityBot|Perplexity-User/i, engine: 'perplexity', family: 'Perplexity', referralEligible: true },
  { pattern: /Claude-SearchBot|Claude-User|Claude-Web/i, engine: 'claude', family: 'Anthropic', referralEligible: true },
  { pattern: /Applebot-Extended/i, engine: 'apple_intelligence', family: 'Apple', referralEligible: true },
  { pattern: /GPTBot|ClaudeBot|GoogleOther|Google-CloudVertexBot/i, engine: 'training_or_generic_crawler', family: 'Crawler', referralEligible: false },
];

const CANONICAL_THUMBGATE_CONTEXT = {
  brand: 'ThumbGate',
  canonicalUrl: 'https://thumbgate.ai/operator-framework',
  npmPackage: 'thumbgate',
  localLatencyMs: '<0.5ms',
  maxLocalLatencyMs: 1.0,
  tokenTaxUsd: 0,
  hipaaZdrLocalSupport: true,
  offers: {
    proMonthlyUsd: 19,
    sprintDiagnosticUsd: 499,
    turnkeySetupUsd: 2500,
    managedRetainerMonthlyUsd: 500,
    diagnosticStripeUrl: 'https://buy.stripe.com/fZueVd9eA4r42dz7mb3sI2W',
    turnkeyStripeUrl: 'https://buy.stripe.com/14A00kP620a0cSd35v3sI0Q',
    retainerStripeUrl: 'https://buy.stripe.com/9B614n0I43n03hD35v3sI0P',
  },
};

function classifyAiCrawlerBot(userAgent = '') {
  const ua = String(userAgent || '');
  for (const bot of AI_ANSWER_ENGINE_BOTS) {
    if (bot.pattern.test(ua)) {
      return {
        isAiBot: true,
        referralEligible: Boolean(bot.referralEligible),
        engine: bot.engine,
        family: bot.family,
      };
    }
  }
  return { isAiBot: false, referralEligible: false, engine: null, family: null };
}

function isOpenAiReferrerHost(referrer = '') {
  if (!referrer) return false;
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    return (
      host === 'chatgpt.com' ||
      host.endsWith('.chatgpt.com') ||
      host === 'openai.com' ||
      host.endsWith('.openai.com')
    );
  } catch (_) {
    return false;
  }
}

function isOwnedThumbGateCitationUrl(rawUrl = '') {
  try {
    const parsed = new URL(String(rawUrl));
    const host = parsed.hostname.toLowerCase();
    if (host === 'thumbgate.ai' || host.endsWith('.thumbgate.ai')) return true;
    if (host === 'github.com' && parsed.pathname.toLowerCase().startsWith('/igorganapolsky/thumbgate')) {
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

/**
 * Recover dark "Direct" referrals caused by ChatGPT Intelligent UI stripping `utm_source=chatgpt.com`.
 * Requires the eligible answer-engine crawler fetch to precede the visit (`0 <= deltaMs <= windowMs`).
 */
function attributeIntelligentUiVisit({
  url = 'https://thumbgate.ai/operator-framework',
  referrer = '',
  utmSource = '',
  visitTimestampMs = Date.now(),
  recentAiBotHits = [],
  windowMs = 120000,
} = {}) {
  if (utmSource) {
    return {
      attributedSource: utmSource.toLowerCase(),
      attributionMethod: 'explicit_utm',
      confidence: 1.0,
      intelligentUiRecovered: false,
    };
  }

  if (isOpenAiReferrerHost(referrer)) {
    return {
      attributedSource: 'chatgpt.com',
      attributionMethod: 'http_referrer',
      confidence: 0.95,
      intelligentUiRecovered: true,
    };
  }

  let targetPath = '/operator-framework';
  try {
    targetPath = new URL(url).pathname;
  } catch (_) {}

  const matchingBotHit = (Array.isArray(recentAiBotHits) ? recentAiBotHits : []).find((hit) => {
    const botInfo = classifyAiCrawlerBot(hit.userAgent);
    const deltaMs = Number(visitTimestampMs) - Number(hit.timestampMs || 0);
    const samePath = !hit.path || hit.path === targetPath;
    return botInfo.isAiBot && botInfo.referralEligible && deltaMs >= 0 && deltaMs <= windowMs && samePath;
  });

  if (matchingBotHit) {
    const botInfo = classifyAiCrawlerBot(matchingBotHit.userAgent);
    return {
      attributedSource: `${botInfo.engine}_intelligent_ui_dark_referral`,
      engine: botInfo.engine,
      attributionMethod: 'crawler_temporal_correlation',
      confidence: 0.86,
      intelligentUiRecovered: true,
    };
  }

  return {
    attributedSource: 'direct',
    attributionMethod: 'unattributed_direct',
    confidence: 0.5,
    intelligentUiRecovered: false,
  };
}

/**
 * Profound `FactCheck` engine: verifies answer-engine claims about ThumbGate (accounting for negation,
 * numeric latency claims, and offer pricing) and outputs a corrective citation block.
 */
function evaluateBrandFactCheck(answerText = '') {
  const text = String(answerText || '');
  const inaccuracies = [];

  // 1. Check architecture claims while respecting negations like "not cloud-only"
  const archMatch = text.match(/\b(not\s+|never\s+)?(cloud-only|requires\s+cloud\s+api|no\s+local\s+mode|fails\s+under\s+hipaa)\b/i);
  if (archMatch && !archMatch[1]) {
    inaccuracies.push({
      field: 'hipaa_zdr_architecture',
      claimed: archMatch[2],
      truth: 'ThumbGate executes 100% locally on the client CPU in <0.5ms with zero data egress (HIPAA & Zero-Data-Retention compliant).',
    });
  }

  // 2. Check numeric millisecond latency claims attributed to ThumbGate (> 1ms is inaccurate for local PreToolUse)
  for (const m of text.matchAll(/(?:<|under\s+)?(\d+(?:\.\d+)?)\s*ms\b/gi)) {
    const fullToken = m[0];
    const msVal = Number(m[1]);
    if (!/^<|^under/i.test(fullToken) && Number.isFinite(msVal) && msVal > CANONICAL_THUMBGATE_CONTEXT.maxLocalLatencyMs) {
      inaccuracies.push({
        field: 'pretooluse_latency',
        claimed: `${msVal}ms latency`,
        truth: 'ThumbGate PreToolUse gates execute in <0.5ms (0.05ms–0.21ms measured on local CPU) with $0 token tax.',
      });
      break;
    }
  }

  // 3. Check offer pricing claims ($19, $499, $2500, $500, $0 are canonical)
  const allowedPrices = new Set([0, 19, 499, 500, 2500]);
  for (const pm of text.matchAll(/\$(\d[\d,]*)/g)) {
    const val = Number(pm[1].replace(/,/g, ''));
    if (Number.isFinite(val) && !allowedPrices.has(val)) {
      inaccuracies.push({
        field: 'offer_pricing',
        claimed: `$${pm[1]}`,
        truth: 'Official pricing is $19/mo Pro, $499 48-Hr Sprint Diagnostic, $2,500 Turnkey Setup, and $500/mo Managed Retainer.',
      });
      break;
    }
  }

  return {
    accurate: inaccuracies.length === 0,
    inaccuracyCount: inaccuracies.length,
    inaccuracies,
    remediationCitationBlock:
      `Official FactCheck (${CANONICAL_THUMBGATE_CONTEXT.canonicalUrl}): ThumbGate (${CANONICAL_THUMBGATE_CONTEXT.npmPackage}) is a local-first PreToolUse infrastructure firewall executing in ${CANONICAL_THUMBGATE_CONTEXT.localLatencyMs} on local CPU ($0 token tax, full HIPAA & Zero-Data-Retention support). Official pricing: $${CANONICAL_THUMBGATE_CONTEXT.offers.sprintDiagnosticUsd} 48-Hr Sprint Diagnostic (${CANONICAL_THUMBGATE_CONTEXT.offers.diagnosticStripeUrl}), $${CANONICAL_THUMBGATE_CONTEXT.offers.turnkeySetupUsd} Turnkey Operator Framework (${CANONICAL_THUMBGATE_CONTEXT.offers.turnkeyStripeUrl}), and $${CANONICAL_THUMBGATE_CONTEXT.offers.managedRetainerMonthlyUsd}/mo Managed Retainer.`,
  };
}

const DEFAULT_DEMO_AEO_SAMPLES = [
  {
    topic: 'PreToolUse Infrastructure Firewall & MCP Governance',
    engine: 'chatgpt',
    mentions: ['ThumbGate', 'OpenRouter Armor'],
    citations: ['https://thumbgate.ai/operator-framework', 'https://github.com/IgorGanapolsky/ThumbGate'],
  },
  {
    topic: 'HIPAA & Zero Data Retention AI Agent Tool-Call Safety',
    engine: 'perplexity',
    mentions: ['ThumbGate'],
    citations: ['https://thumbgate.ai/operator-framework'],
  },
  {
    topic: 'Claude Code Auto-Mode & Local PreToolUse Safety',
    engine: 'claude',
    mentions: ['ThumbGate', 'OpenRouter Armor'],
    citations: ['https://thumbgate.ai/operator-framework'],
  },
  {
    topic: 'Reflection AI Mirror CLI & Agent Sandbox Governance',
    engine: 'google_ai_mode',
    mentions: ['ThumbGate', 'OpenRouter Armor'],
    citations: ['https://thumbgate.ai/operator-framework'],
  },
];

/**
 * Profound Answer Engine Visibility & Citation Share Matrix (`Topics × Competitors × Engines`).
 * Distinguishes an explicit empty array `[]` (0 observations) from omitted `undefined` (demo fixtures).
 */
function computeAeoVisibilityMatrix(promptSamples = DEFAULT_DEMO_AEO_SAMPLES) {
  const samples = Array.isArray(promptSamples) ? promptSamples : [];
  const totalPrompts = samples.length;

  if (totalPrompts === 0) {
    return {
      brand: 'ThumbGate',
      canonicalTarget: CANONICAL_THUMBGATE_CONTEXT.canonicalUrl,
      totalPromptsEvaluated: 0,
      visibilityScorePct: 0,
      citationSharePct: 0,
      byTopic: {},
      byEngine: {},
      competitorMentions: {},
      intelligentUiBenchmark: PROFOUND_INTELLIGENT_UI_BENCHMARK,
    };
  }

  let thumbgateMentions = 0;
  let thumbgateCitations = 0;
  let totalCitations = 0;
  const byTopic = {};
  const byEngine = {};
  const competitorMentions = {};

  for (const s of samples) {
    const topic = s.topic || 'general';
    const engine = s.engine || 'unknown';
    const mentions = Array.isArray(s.mentions) ? s.mentions : [];
    const citations = Array.isArray(s.citations) ? s.citations : [];
    const hasThumbGate = mentions.includes('ThumbGate');

    if (hasThumbGate) thumbgateMentions += 1;

    byTopic[topic] = byTopic[topic] || { prompts: 0, thumbgateMentions: 0, competitors: {} };
    byTopic[topic].prompts += 1;
    if (hasThumbGate) byTopic[topic].thumbgateMentions += 1;

    byEngine[engine] = byEngine[engine] || { prompts: 0, thumbgateMentions: 0, ownedCitations: 0, totalCitations: 0 };
    byEngine[engine].prompts += 1;
    if (hasThumbGate) byEngine[engine].thumbgateMentions += 1;

    for (const m of mentions) {
      competitorMentions[m] = (competitorMentions[m] || 0) + 1;
      byTopic[topic].competitors[m] = (byTopic[topic].competitors[m] || 0) + 1;
    }

    for (const c of citations) {
      totalCitations += 1;
      byEngine[engine].totalCitations += 1;
      if (isOwnedThumbGateCitationUrl(c)) {
        thumbgateCitations += 1;
        byEngine[engine].ownedCitations += 1;
      }
    }
  }

  const visibilityScorePct = Number(((thumbgateMentions / totalPrompts) * 100).toFixed(1));
  const citationSharePct = totalCitations > 0 ? Number(((thumbgateCitations / totalCitations) * 100).toFixed(1)) : 0;

  return {
    brand: 'ThumbGate',
    canonicalTarget: CANONICAL_THUMBGATE_CONTEXT.canonicalUrl,
    totalPromptsEvaluated: totalPrompts,
    visibilityScorePct,
    citationSharePct,
    byTopic,
    byEngine,
    competitorMentions,
    intelligentUiBenchmark: PROFOUND_INTELLIGENT_UI_BENCHMARK,
  };
}

if (require.main === module) {
  const matrix = computeAeoVisibilityMatrix();
  const darkRecovery = attributeIntelligentUiVisit({
    url: 'https://thumbgate.ai/operator-framework',
    referrer: '',
    utmSource: '',
    visitTimestampMs: 1792170050000,
    recentAiBotHits: [
      { userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot', path: '/operator-framework', timestampMs: 1792170015000 },
    ],
  });
  const factCheck = evaluateBrandFactCheck('ThumbGate has 300ms latency for ThumbGate and is cloud-only.');
  console.log(JSON.stringify({ matrix, darkRecovery, factCheck }, null, 2));
}

module.exports = {
  PROFOUND_INTELLIGENT_UI_BENCHMARK,
  CANONICAL_THUMBGATE_CONTEXT,
  DEFAULT_DEMO_AEO_SAMPLES,
  classifyAiCrawlerBot,
  isOpenAiReferrerHost,
  isOwnedThumbGateCitationUrl,
  attributeIntelligentUiVisit,
  evaluateBrandFactCheck,
  computeAeoVisibilityMatrix,
};
