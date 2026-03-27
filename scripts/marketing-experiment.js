'use strict';
/**
 * Marketing Experiment Engine (AUTORESEARCH-02)
 *
 * Extends the experiment-tracker with marketing-specific variant generation,
 * scoring, and selection. Implements the autoresearch loop for marketing:
 *   generate variants → score against metrics → keep top performers →
 *   feed winners back → generate next batch
 *
 * Channels: cold_email, ad_creative, landing_page, youtube_assets, sales_script
 *
 * Uses Thompson Sampling to balance exploration (new angles) vs exploitation
 * (proven winners). The core engine is local-first; when a research query is
 * provided it can ingest Hugging Face paper context into ContextFS first.
 *
 * Exports: createMarketingExperiment, recordMarketingResult, generateVariants,
 *          selectWinners, getChannelProgress, getWinningPatterns,
 *          MARKETING_CHANNELS, MARKETING_METRICS
 */

const fs = require('fs');
const path = require('path');
const { getFeedbackPaths, readJSONL } = require('./feedback-loop');
const { loadModel, saveModel, updateModel, samplePosteriors, getReliability } = require('./thompson-sampling');
const { buildResearchBrief } = require('./hf-papers');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MARKETING_CHANNELS = [
  'cold_email',
  'ad_creative',
  'landing_page',
  'youtube_assets',
  'sales_script',
];

const MARKETING_METRICS = {
  cold_email: ['open_rate', 'reply_rate', 'meeting_booked_rate'],
  ad_creative: ['ctr', 'cpc', 'conversion_rate', 'roas'],
  landing_page: ['bounce_rate', 'conversion_rate', 'time_on_page'],
  youtube_assets: ['ctr', 'avg_view_duration', 'subscriber_conversion'],
  sales_script: ['meeting_conversion', 'demo_to_close', 'objection_handle_rate'],
};

/** Top N% of variants to keep each cycle */
const DEFAULT_KEEP_RATE = 0.20;

/** Minimum variants per batch */
const MIN_BATCH_SIZE = 5;

/** Maximum variants per batch */
const MAX_BATCH_SIZE = 50;

/** Signal window defaults in hours per channel */
const SIGNAL_WINDOWS = {
  cold_email: 72,
  ad_creative: 48,
  landing_page: 168,
  youtube_assets: 168,
  sales_script: 48,
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getMarketingPaths() {
  const { FEEDBACK_DIR } = getFeedbackPaths();
  const marketingDir = path.join(FEEDBACK_DIR, 'marketing');
  return {
    marketingDir,
    experimentsPath: path.join(marketingDir, 'experiments.jsonl'),
    variantsPath: path.join(marketingDir, 'variants.jsonl'),
    winnersPath: path.join(marketingDir, 'winners.jsonl'),
    progressPath: path.join(marketingDir, 'progress.json'),
    modelPath: path.join(marketingDir, 'marketing_model.json'),
    knowledgePath: path.join(marketingDir, 'knowledge-base.jsonl'),
  };
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function appendJSONL(filePath, record) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
}

function readJSONLFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
  const records = [];
  for (const line of lines) {
    try { records.push(JSON.parse(line)); } catch { /* skip bad lines */ }
  }
  return records;
}

// ---------------------------------------------------------------------------
// Variant Generation
// ---------------------------------------------------------------------------

/**
 * Generate a batch of marketing variants for a given channel.
 * Uses winning patterns to condition generation when available.
 *
 * @param {object} params
 * @param {string} params.channel - Marketing channel (cold_email, ad_creative, etc.)
 * @param {number} [params.batchSize=20] - Number of variants to generate
 * @param {string} [params.targetAudience] - Target audience description
 * @param {string} [params.product] - Product/service description
 * @param {string[]} [params.constraints] - Brand/style constraints
 * @param {object[]} [params.seedWinners] - Previous winners to iterate from
 * @param {string} [params.researchQuery] - Optional external research query
 * @param {number} [params.paperLimit] - Max papers to ingest for research context
 * @returns {Promise<object>} batch record with variant templates
 */
async function generateVariants(params) {
  if (!params || !params.channel) {
    throw new Error('generateVariants requires channel');
  }
  if (!MARKETING_CHANNELS.includes(params.channel)) {
    throw new Error(`Invalid channel "${params.channel}". Must be one of: ${MARKETING_CHANNELS.join(', ')}`);
  }

  const batchSize = Math.min(
    Math.max(Number(params.batchSize) || 20, MIN_BATCH_SIZE),
    MAX_BATCH_SIZE,
  );

  const paths = getMarketingPaths();
  const existingWinners = params.seedWinners || getWinningPatterns(params.channel, 5);
  const research = params.researchQuery
    ? await buildResearchBrief({
      query: params.researchQuery,
      limit: params.paperLimit,
      fetchImpl: params.fetchImpl,
      searchPapersImpl: params.searchPapersImpl,
      template: 'gtm-research',
    })
    : null;

  // Load Thompson model for explore/exploit balance
  const model = loadModel(paths.modelPath);
  const posteriors = samplePosteriors(model);
  const channelScore = posteriors[params.channel] || 0.5;

  // Higher score = more exploitation (iterate from winners)
  // Lower score = more exploration (try new angles)
  const exploitRatio = channelScore;
  const exploitCount = Math.round(batchSize * exploitRatio);
  const exploreCount = batchSize - exploitCount;

  const variants = [];
  const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Exploitation variants: iterate from winners
  for (let i = 0; i < exploitCount; i++) {
    const seedIdx = existingWinners.length > 0 ? i % existingWinners.length : -1;
    const seed = seedIdx >= 0 ? existingWinners[seedIdx] : null;
    variants.push({
      id: `var_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      batchId,
      channel: params.channel,
      strategy: 'exploit',
      seedVariantId: seed ? seed.id : null,
      seedPattern: seed ? seed.winningPattern : null,
      targetAudience: params.targetAudience || null,
      product: params.product || null,
      constraints: params.constraints || [],
      researchQuery: research ? research.query : null,
      researchPackId: research ? research.packId : null,
      researchPaperIds: research ? research.citations.map((citation) => citation.paperId).filter(Boolean) : [],
      researchBrief: research ? research.brief : null,
      metrics: Object.fromEntries(
        (MARKETING_METRICS[params.channel] || []).map(m => [m, null]),
      ),
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
  }

  // Exploration variants: novel angles
  for (let i = 0; i < exploreCount; i++) {
    variants.push({
      id: `var_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      batchId,
      channel: params.channel,
      strategy: 'explore',
      seedVariantId: null,
      seedPattern: null,
      targetAudience: params.targetAudience || null,
      product: params.product || null,
      constraints: params.constraints || [],
      researchQuery: research ? research.query : null,
      researchPackId: research ? research.packId : null,
      researchPaperIds: research ? research.citations.map((citation) => citation.paperId).filter(Boolean) : [],
      researchBrief: research ? research.brief : null,
      metrics: Object.fromEntries(
        (MARKETING_METRICS[params.channel] || []).map(m => [m, null]),
      ),
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
  }

  // Persist variants
  for (const v of variants) {
    appendJSONL(paths.variantsPath, v);
  }

  const batch = {
    batchId,
    channel: params.channel,
    totalVariants: variants.length,
    exploitCount,
    exploreCount,
    exploitRatio: Number(exploitRatio.toFixed(3)),
    signalWindowHours: SIGNAL_WINDOWS[params.channel] || 72,
    targetAudience: params.targetAudience || null,
    product: params.product || null,
    researchQuery: research ? research.query : null,
    researchPackId: research ? research.packId : null,
    researchPaperIds: research ? research.citations.map((citation) => citation.paperId).filter(Boolean) : [],
    researchBrief: research ? research.brief : null,
    createdAt: new Date().toISOString(),
    variants: variants.map(v => ({ id: v.id, strategy: v.strategy })),
  };

  return batch;
}

// ---------------------------------------------------------------------------
// Experiment Lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a marketing experiment (wraps a batch of variants).
 *
 * @param {object} params
 * @param {string} params.channel - Marketing channel
 * @param {string} params.hypothesis - What the experiment tests
 * @param {number} [params.batchSize=20] - Variants per batch
 * @param {string} [params.targetAudience] - Target audience
 * @param {string} [params.product] - Product description
 * @param {string[]} [params.constraints] - Brand constraints
 * @param {string} [params.researchQuery] - Optional external research query
 * @param {number} [params.paperLimit] - Max papers to ingest for research context
 * @returns {Promise<object>} experiment record with batch
 */
async function createMarketingExperiment(params) {
  if (!params || !params.channel || !params.hypothesis) {
    throw new Error('createMarketingExperiment requires channel and hypothesis');
  }

  const batch = await generateVariants(params);
  const paths = getMarketingPaths();

  const experiment = {
    id: `mktexp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    channel: params.channel,
    hypothesis: params.hypothesis,
    batchId: batch.batchId,
    batchSize: batch.totalVariants,
    exploitRatio: batch.exploitRatio,
    targetAudience: params.targetAudience || null,
    product: params.product || null,
    constraints: params.constraints || [],
    researchQuery: batch.researchQuery || null,
    researchPackId: batch.researchPackId || null,
    researchPaperIds: batch.researchPaperIds || [],
    researchBrief: batch.researchBrief || null,
    status: 'running',
    createdAt: new Date().toISOString(),
    completedAt: null,
    signalWindowHours: batch.signalWindowHours,
    results: null,
  };

  appendJSONL(paths.experimentsPath, experiment);
  return { experiment, batch };
}

/**
 * Record metrics for a specific variant.
 *
 * @param {object} params
 * @param {string} params.variantId - Variant ID
 * @param {object} params.metrics - Metric values (e.g., { open_rate: 0.32, reply_rate: 0.08 })
 * @returns {object} updated variant
 */
function recordVariantMetrics(params) {
  if (!params || !params.variantId || !params.metrics) {
    throw new Error('recordVariantMetrics requires variantId and metrics');
  }

  const paths = getMarketingPaths();
  const variants = readJSONLFile(paths.variantsPath);
  const variant = variants.find(v => v.id === params.variantId);

  if (!variant) {
    throw new Error(`Variant ${params.variantId} not found`);
  }

  const updated = {
    ...variant,
    metrics: { ...variant.metrics, ...params.metrics },
    status: 'measured',
    measuredAt: new Date().toISOString(),
  };

  appendJSONL(paths.variantsPath, updated);
  return updated;
}

/**
 * Select winners from a batch and update Thompson model.
 *
 * @param {object} params
 * @param {string} params.batchId - Batch ID to evaluate
 * @param {string} [params.primaryMetric] - Metric to rank by (default: first metric for channel)
 * @param {number} [params.keepRate=0.20] - Top N% to keep
 * @returns {object} selection results with winners and losers
 */
function selectWinners(params) {
  if (!params || !params.batchId) {
    throw new Error('selectWinners requires batchId');
  }

  const paths = getMarketingPaths();
  const allVariants = readJSONLFile(paths.variantsPath);

  // Get latest state of each variant in this batch (last write wins)
  const batchMap = new Map();
  for (const v of allVariants) {
    if (v.batchId === params.batchId) {
      batchMap.set(v.id, v);
    }
  }
  const batchVariants = Array.from(batchMap.values());

  if (batchVariants.length === 0) {
    throw new Error(`No variants found for batch ${params.batchId}`);
  }

  const channel = batchVariants[0].channel;
  const channelMetrics = MARKETING_METRICS[channel] || [];
  const primaryMetric = params.primaryMetric || channelMetrics[0];

  if (!primaryMetric) {
    throw new Error(`No metric defined for channel ${channel}`);
  }

  // Score variants by primary metric
  const scored = batchVariants
    .filter(v => v.metrics && v.metrics[primaryMetric] != null)
    .map(v => ({
      ...v,
      primaryScore: Number(v.metrics[primaryMetric]) || 0,
    }))
    .sort((a, b) => b.primaryScore - a.primaryScore);

  const keepRate = Number(params.keepRate) || DEFAULT_KEEP_RATE;
  const keepCount = Math.max(1, Math.round(scored.length * keepRate));
  const winners = scored.slice(0, keepCount);
  const losers = scored.slice(keepCount);
  const unmeasured = batchVariants.filter(
    v => !v.metrics || v.metrics[primaryMetric] == null,
  );

  // Persist winners
  for (const w of winners) {
    const winnerRecord = {
      ...w,
      status: 'winner',
      winningPattern: extractPattern(w),
      selectedAt: new Date().toISOString(),
    };
    appendJSONL(paths.winnersPath, winnerRecord);
  }

  // Update Thompson model: winners = positive signal, losers = negative
  const model = loadModel(paths.modelPath);
  for (const w of winners) {
    updateModel(model, {
      signal: 'positive',
      timestamp: new Date().toISOString(),
      categories: [channel],
    });
  }
  for (const l of losers) {
    updateModel(model, {
      signal: 'negative',
      timestamp: new Date().toISOString(),
      categories: [channel],
    });
  }

  // Persist Thompson model updates
  saveModel(model, paths.modelPath);

  // Log to knowledge base
  const knowledgeEntry = {
    batchId: params.batchId,
    channel,
    primaryMetric,
    totalScored: scored.length,
    winnersCount: winners.length,
    losersCount: losers.length,
    unmeasuredCount: unmeasured.length,
    keepRate,
    topScore: winners.length > 0 ? winners[0].primaryScore : null,
    avgWinnerScore: winners.length > 0
      ? Number((winners.reduce((s, w) => s + w.primaryScore, 0) / winners.length).toFixed(4))
      : null,
    avgLoserScore: losers.length > 0
      ? Number((losers.reduce((s, l) => s + l.primaryScore, 0) / losers.length).toFixed(4))
      : null,
    winningStrategies: winners.map(w => w.strategy),
    researchQuery: batchVariants[0].researchQuery || null,
    researchPackId: batchVariants[0].researchPackId || null,
    researchPaperIds: [...new Set(batchVariants.flatMap((variant) => variant.researchPaperIds || []))],
    timestamp: new Date().toISOString(),
  };
  appendJSONL(paths.knowledgePath, knowledgeEntry);

  // Update progress
  updateMarketingProgress();

  return {
    batchId: params.batchId,
    channel,
    primaryMetric,
    keepRate,
    winners: winners.map(w => ({
      id: w.id,
      strategy: w.strategy,
      score: w.primaryScore,
      pattern: extractPattern(w),
    })),
    losers: losers.map(l => ({
      id: l.id,
      strategy: l.strategy,
      score: l.primaryScore,
    })),
    unmeasured: unmeasured.map(u => u.id),
    reliability: getReliability(model)[channel] || null,
  };
}

// ---------------------------------------------------------------------------
// Knowledge & Patterns
// ---------------------------------------------------------------------------

/**
 * Extract a reusable pattern from a winning variant.
 */
function extractPattern(variant) {
  return {
    channel: variant.channel,
    strategy: variant.strategy,
    seedPattern: variant.seedPattern,
    metrics: variant.metrics,
    constraints: variant.constraints,
  };
}

/**
 * Get winning patterns for a channel, ordered by recency.
 *
 * @param {string} channel - Marketing channel
 * @param {number} [limit=5] - Max winners to return
 * @returns {object[]}
 */
function getWinningPatterns(channel, limit = 5) {
  const paths = getMarketingPaths();
  const winners = readJSONLFile(paths.winnersPath);
  return winners
    .filter(w => w.channel === channel)
    .slice(-limit)
    .reverse();
}

/**
 * Get cross-channel knowledge entries.
 *
 * @param {object} [opts]
 * @param {string} [opts.channel] - Filter by channel
 * @param {number} [opts.limit=20] - Max entries
 * @returns {object[]}
 */
function getKnowledgeBase(opts = {}) {
  const paths = getMarketingPaths();
  let entries = readJSONLFile(paths.knowledgePath);
  if (opts.channel) {
    entries = entries.filter(e => e.channel === opts.channel);
  }
  return entries.slice(-(opts.limit || 20)).reverse();
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

function updateMarketingProgress() {
  const paths = getMarketingPaths();
  const experiments = readJSONLFile(paths.experimentsPath);
  const knowledge = readJSONLFile(paths.knowledgePath);
  const winners = readJSONLFile(paths.winnersPath);

  const channelStats = {};
  for (const ch of MARKETING_CHANNELS) {
    const chExps = experiments.filter(e => e.channel === ch);
    const chWinners = winners.filter(w => w.channel === ch);
    const chKnowledge = knowledge.filter(k => k.channel === ch);
    const avgWinScore = chKnowledge.length > 0
      ? chKnowledge.filter(k => k.avgWinnerScore != null)
          .reduce((s, k) => s + k.avgWinnerScore, 0) / Math.max(1, chKnowledge.filter(k => k.avgWinnerScore != null).length)
      : null;

    channelStats[ch] = {
      experiments: chExps.length,
      winners: chWinners.length,
      batches: chKnowledge.length,
      avgWinnerScore: avgWinScore != null ? Number(avgWinScore.toFixed(4)) : null,
    };
  }

  const progress = {
    totalExperiments: experiments.length,
    totalWinners: winners.length,
    totalBatchesScored: knowledge.length,
    channels: channelStats,
    lastUpdated: new Date().toISOString(),
  };

  ensureDir(path.dirname(paths.progressPath));
  fs.writeFileSync(paths.progressPath, JSON.stringify(progress, null, 2) + '\n');
  return progress;
}

/**
 * Get marketing experiment progress.
 * @param {string} [channel] - Optional channel filter
 * @returns {object}
 */
function getChannelProgress(channel) {
  const paths = getMarketingPaths();
  if (fs.existsSync(paths.progressPath)) {
    try {
      const progress = JSON.parse(fs.readFileSync(paths.progressPath, 'utf-8'));
      if (channel) {
        return progress.channels[channel] || { experiments: 0, winners: 0, batches: 0 };
      }
      return progress;
    } catch { /* fall through */ }
  }
  return updateMarketingProgress();
}

/**
 * Record final experiment result (after selectWinners).
 *
 * @param {object} params
 * @param {string} params.experimentId - Experiment ID
 * @param {string} params.batchId - Batch that was scored
 * @param {number} params.winnersCount - How many winners
 * @param {number} params.totalScored - How many scored
 * @param {number} [params.topScore] - Best score
 * @returns {object}
 */
function recordMarketingResult(params) {
  if (!params || !params.experimentId) {
    throw new Error('recordMarketingResult requires experimentId');
  }

  const paths = getMarketingPaths();
  const result = {
    id: params.experimentId,
    status: 'completed',
    completedAt: new Date().toISOString(),
    batchId: params.batchId || null,
    winnersCount: params.winnersCount || 0,
    totalScored: params.totalScored || 0,
    topScore: params.topScore || null,
    keepRate: params.totalScored > 0
      ? Number((params.winnersCount / params.totalScored).toFixed(3))
      : 0,
  };

  appendJSONL(paths.experimentsPath, result);
  updateMarketingProgress();
  return result;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = {};
  process.argv.slice(2).forEach(arg => {
    if (!arg.startsWith('--')) return;
    const [key, ...rest] = arg.slice(2).split('=');
    args[key] = rest.length > 0 ? rest.join('=') : true;
  });

  if (args.test) {
    // Inline smoke test
    console.log('Marketing Experiment Engine — smoke test');
    (async () => {
      const batch = await generateVariants({ channel: 'cold_email', batchSize: 10, product: 'ThumbGate' });
      console.log(`  Generated batch ${batch.batchId}: ${batch.totalVariants} variants (${batch.exploitCount} exploit, ${batch.exploreCount} explore)`);

      // Simulate metrics
      for (const v of batch.variants) {
        recordVariantMetrics({ variantId: v.id, metrics: { open_rate: Math.random() * 0.5, reply_rate: Math.random() * 0.15 } });
      }
      console.log('  Recorded metrics for all variants');

      const selection = selectWinners({ batchId: batch.batchId, primaryMetric: 'open_rate' });
      console.log(`  Selected ${selection.winners.length} winners, ${selection.losers.length} losers`);
      console.log(`  Top score: ${selection.winners[0]?.score?.toFixed(3) || 'n/a'}`);

      const progress = getChannelProgress();
      console.log(`  Progress: ${JSON.stringify(progress, null, 2)}`);
      console.log('✅ Marketing Experiment Engine smoke test passed');
    })().catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
  } else if (args.progress) {
    console.log(JSON.stringify(getChannelProgress(args.channel || null), null, 2));
  } else if (args.winners) {
    const channel = args.channel || 'cold_email';
    console.log(JSON.stringify(getWinningPatterns(channel, 10), null, 2));
  } else if (args.knowledge) {
    console.log(JSON.stringify(getKnowledgeBase({ channel: args.channel || null }), null, 2));
  } else {
    console.log(`Usage:
  node scripts/marketing-experiment.js --test
  node scripts/marketing-experiment.js --progress [--channel=cold_email]
  node scripts/marketing-experiment.js --winners [--channel=cold_email]
  node scripts/marketing-experiment.js --knowledge [--channel=cold_email]`);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  createMarketingExperiment,
  recordMarketingResult,
  recordVariantMetrics,
  generateVariants,
  selectWinners,
  getChannelProgress,
  getWinningPatterns,
  getKnowledgeBase,
  getMarketingPaths,
  updateMarketingProgress,
  MARKETING_CHANNELS,
  MARKETING_METRICS,
  SIGNAL_WINDOWS,
};
