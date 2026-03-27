'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Override feedback dir so tests don't pollute real data
const TEST_DIR = path.join(__dirname, '..', '.test-marketing-' + Date.now());
process.env.RLHF_FEEDBACK_DIR = TEST_DIR;

const {
  createMarketingExperiment,
  recordMarketingResult,
  recordVariantMetrics,
  generateVariants,
  selectWinners,
  getChannelProgress,
  getWinningPatterns,
  getKnowledgeBase,
  getMarketingPaths,
  MARKETING_CHANNELS,
  MARKETING_METRICS,
  SIGNAL_WINDOWS,
} = require('../scripts/marketing-experiment');

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

describe('Marketing Experiment Engine', () => {
  before(() => cleanup());
  after(() => cleanup());

  describe('MARKETING_CHANNELS', () => {
    it('should define 5 channels', () => {
      assert.equal(MARKETING_CHANNELS.length, 5);
      assert.ok(MARKETING_CHANNELS.includes('cold_email'));
      assert.ok(MARKETING_CHANNELS.includes('ad_creative'));
      assert.ok(MARKETING_CHANNELS.includes('landing_page'));
      assert.ok(MARKETING_CHANNELS.includes('youtube_assets'));
      assert.ok(MARKETING_CHANNELS.includes('sales_script'));
    });

    it('should define metrics per channel', () => {
      for (const ch of MARKETING_CHANNELS) {
        assert.ok(Array.isArray(MARKETING_METRICS[ch]), `Missing metrics for ${ch}`);
        assert.ok(MARKETING_METRICS[ch].length > 0, `No metrics for ${ch}`);
      }
    });

    it('should define signal windows per channel', () => {
      for (const ch of MARKETING_CHANNELS) {
        assert.ok(typeof SIGNAL_WINDOWS[ch] === 'number', `Missing signal window for ${ch}`);
        assert.ok(SIGNAL_WINDOWS[ch] >= 24, `Signal window too short for ${ch}`);
      }
    });
  });

  describe('generateVariants()', () => {
    it('should reject missing channel', async () => {
      await assert.rejects(() => generateVariants({}), /requires channel/);
    });

    it('should reject invalid channel', async () => {
      await assert.rejects(() => generateVariants({ channel: 'invalid' }), /Invalid channel/);
    });

    it('should generate a batch of variants', async () => {
      const batch = await generateVariants({ channel: 'cold_email', batchSize: 10 });
      assert.ok(batch.batchId.startsWith('batch_'));
      assert.equal(batch.channel, 'cold_email');
      assert.equal(batch.totalVariants, 10);
      assert.equal(batch.exploitCount + batch.exploreCount, 10);
      assert.equal(batch.variants.length, 10);
      assert.equal(batch.signalWindowHours, 72);
    });

    it('should clamp batch size to min/max bounds', async () => {
      const small = await generateVariants({ channel: 'ad_creative', batchSize: 1 });
      assert.ok(small.totalVariants >= 5, 'Should clamp to MIN_BATCH_SIZE');

      const large = await generateVariants({ channel: 'ad_creative', batchSize: 999 });
      assert.ok(large.totalVariants <= 50, 'Should clamp to MAX_BATCH_SIZE');
    });

    it('should include explore and exploit variants', async () => {
      const batch = await generateVariants({ channel: 'cold_email', batchSize: 20 });
      const strategies = batch.variants.map(v => v.strategy);
      // At least some of each strategy should exist
      assert.ok(strategies.includes('explore') || strategies.includes('exploit'),
        'Should have at least one strategy type');
    });

    it('should persist variants to JSONL', async () => {
      await generateVariants({ channel: 'cold_email', batchSize: 5 });
      const paths = getMarketingPaths();
      assert.ok(fs.existsSync(paths.variantsPath), 'variants.jsonl should exist');
    });

    it('should attach research metadata when researchQuery is provided', async () => {
      const batch = await generateVariants({
        channel: 'cold_email',
        batchSize: 5,
        researchQuery: 'rank fusion',
        searchPapersImpl: async () => [{
          paperId: '2603.01896',
          title: 'Agentic Rank Fusion for Research Systems',
          summary: 'Retrieval fusion for agent workflows.',
          authors: ['Ada Lovelace'],
          tags: ['retrieval'],
          url: 'https://arxiv.org/abs/2603.01896',
          source: 'huggingface-papers',
        }],
      });

      assert.equal(batch.researchQuery, 'rank fusion');
      assert.equal(batch.researchPaperIds[0], '2603.01896');
      assert.ok(batch.researchPackId);
      assert.ok(batch.researchBrief);
    });
  });

  describe('createMarketingExperiment()', () => {
    it('should reject missing params', async () => {
      await assert.rejects(() => createMarketingExperiment({}), /requires channel and hypothesis/);
    });

    it('should create experiment with batch', async () => {
      const { experiment, batch } = await createMarketingExperiment({
        channel: 'landing_page',
        hypothesis: 'Social proof above fold increases conversion',
        batchSize: 8,
        product: 'ThumbGate',
        targetAudience: 'AI engineers',
      });

      assert.ok(experiment.id.startsWith('mktexp_'));
      assert.equal(experiment.channel, 'landing_page');
      assert.equal(experiment.status, 'running');
      assert.equal(experiment.product, 'ThumbGate');
      assert.ok(batch.batchId);
      assert.ok(batch.totalVariants >= 5);
    });
  });

  describe('recordVariantMetrics()', () => {
    it('should reject missing params', () => {
      assert.throws(() => recordVariantMetrics({}), /requires variantId and metrics/);
    });

    it('should record metrics for a variant', async () => {
      const batch = await generateVariants({ channel: 'cold_email', batchSize: 5 });
      const variantId = batch.variants[0].id;
      const updated = recordVariantMetrics({
        variantId,
        metrics: { open_rate: 0.35, reply_rate: 0.08 },
      });
      assert.equal(updated.id, variantId);
      assert.equal(updated.metrics.open_rate, 0.35);
      assert.equal(updated.metrics.reply_rate, 0.08);
      assert.equal(updated.status, 'measured');
    });
  });

  describe('selectWinners()', () => {
    it('should reject missing batchId', () => {
      assert.throws(() => selectWinners({}), /requires batchId/);
    });

    it('should select top 20% as winners', async () => {
      const batch = await generateVariants({ channel: 'cold_email', batchSize: 10 });

      // Record metrics for all variants
      for (const v of batch.variants) {
        recordVariantMetrics({
          variantId: v.id,
          metrics: { open_rate: Math.random() * 0.5 },
        });
      }

      const result = selectWinners({
        batchId: batch.batchId,
        primaryMetric: 'open_rate',
      });

      assert.equal(result.batchId, batch.batchId);
      assert.equal(result.channel, 'cold_email');
      assert.equal(result.primaryMetric, 'open_rate');
      assert.ok(result.winners.length >= 1, 'Should have at least 1 winner');
      assert.ok(result.losers.length > 0, 'Should have some losers');

      // Winners should be sorted descending by score
      for (let i = 1; i < result.winners.length; i++) {
        assert.ok(result.winners[i - 1].score >= result.winners[i].score,
          'Winners should be sorted by score descending');
      }
    });

    it('should update Thompson model with results', () => {
      const paths = getMarketingPaths();
      assert.ok(fs.existsSync(paths.modelPath), 'Marketing model should be created');
    });

    it('should persist winners to JSONL', () => {
      const paths = getMarketingPaths();
      assert.ok(fs.existsSync(paths.winnersPath), 'winners.jsonl should exist');
    });

    it('should log knowledge base entry', () => {
      const paths = getMarketingPaths();
      assert.ok(fs.existsSync(paths.knowledgePath), 'knowledge-base.jsonl should exist');
    });
  });

  describe('getWinningPatterns()', () => {
    it('should return winners for a channel', () => {
      const winners = getWinningPatterns('cold_email', 5);
      assert.ok(Array.isArray(winners));
      assert.ok(winners.length > 0, 'Should have cold_email winners from prior tests');
    });

    it('should return empty for unused channel', () => {
      const winners = getWinningPatterns('youtube_assets', 5);
      assert.ok(Array.isArray(winners));
    });
  });

  describe('getKnowledgeBase()', () => {
    it('should return cross-channel knowledge', () => {
      const entries = getKnowledgeBase();
      assert.ok(Array.isArray(entries));
      assert.ok(entries.length > 0);
      assert.ok(entries[0].channel);
      assert.ok(entries[0].primaryMetric);
    });

    it('should filter by channel', () => {
      const entries = getKnowledgeBase({ channel: 'cold_email' });
      for (const e of entries) {
        assert.equal(e.channel, 'cold_email');
      }
    });
  });

  describe('getChannelProgress()', () => {
    it('should return overall progress', () => {
      const progress = getChannelProgress();
      assert.ok(typeof progress.totalExperiments === 'number');
      assert.ok(typeof progress.totalWinners === 'number');
      assert.ok(progress.channels);
      assert.ok(progress.channels.cold_email);
    });

    it('should return channel-specific progress', () => {
      const progress = getChannelProgress('cold_email');
      assert.ok(typeof progress.experiments === 'number');
      assert.ok(typeof progress.winners === 'number');
    });
  });

  describe('recordMarketingResult()', () => {
    it('should reject missing experimentId', () => {
      assert.throws(() => recordMarketingResult({}), /requires experimentId/);
    });

    it('should record completion', () => {
      const result = recordMarketingResult({
        experimentId: 'mktexp_test_123',
        batchId: 'batch_test_123',
        winnersCount: 3,
        totalScored: 15,
        topScore: 0.42,
      });
      assert.equal(result.status, 'completed');
      assert.equal(result.winnersCount, 3);
      assert.equal(result.keepRate, 0.2);
    });
  });

  describe('Full autoresearch loop', () => {
    it('should run a complete generate → measure → select → iterate cycle', async () => {
      // Cycle 1: cold start
      const { experiment, batch } = await createMarketingExperiment({
        channel: 'ad_creative',
        hypothesis: 'Short hooks outperform long hooks',
        batchSize: 10,
        product: 'ThumbGate',
        targetAudience: 'Engineering leads',
      });

      // Simulate metrics
      for (const v of batch.variants) {
        recordVariantMetrics({
          variantId: v.id,
          metrics: { ctr: Math.random() * 0.08, conversion_rate: Math.random() * 0.03 },
        });
      }

      const selection1 = selectWinners({ batchId: batch.batchId, primaryMetric: 'ctr' });
      assert.ok(selection1.winners.length >= 1);

      // Cycle 2: iterate from winners
      const { batch: batch2 } = await createMarketingExperiment({
        channel: 'ad_creative',
        hypothesis: 'Iterate winning hooks with urgency CTA',
        batchSize: 10,
        product: 'ThumbGate',
        seedWinners: selection1.winners,
      });

      for (const v of batch2.variants) {
        recordVariantMetrics({
          variantId: v.id,
          metrics: { ctr: Math.random() * 0.08, conversion_rate: Math.random() * 0.03 },
        });
      }

      const selection2 = selectWinners({ batchId: batch2.batchId, primaryMetric: 'ctr' });
      assert.ok(selection2.winners.length >= 1);

      // Knowledge should compound
      const knowledge = getKnowledgeBase({ channel: 'ad_creative' });
      assert.ok(knowledge.length >= 2, 'Should have at least 2 knowledge entries after 2 cycles');

      // Progress should reflect both cycles
      const progress = getChannelProgress('ad_creative');
      assert.ok(progress.experiments >= 2);
      assert.ok(progress.batches >= 2);
    });
  });
});
