'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { YambdaRetrievalEngine, INTERACTION_TYPES } = require('../src/yambda-retrieval-engine');

describe('YambdaRetrievalEngine (Yandex YAMBDA-5B Dynamics)', () => {
  it('should rank items based on dense embeddings, organic discovery, and feedback reversals', () => {
    const engine = new YambdaRetrievalEngine();

    // Register two items with normalized embeddings
    const itemA = engine.registerItem('rule:fail_closed', { desc: 'Fail closed guardrail' }, [1.0, 0.0, 0.0]);
    const itemB = engine.registerItem('rule:loose_regex', { desc: 'Loose regex matching' }, [0.0, 1.0, 0.0]);

    // Record organic upvote and high replay (>100% dwell) on itemA
    engine.recordInteraction({
      actorId: 'dev_1',
      itemId: 'rule:fail_closed',
      eventType: INTERACTION_TYPES.UPVOTE,
      isOrganic: true,
      dwellRatioPct: 150, // Replayed and cloned across multiple files
    });

    // Record algorithmic upvote on itemB, followed by REVERT_UPVOTE (unlike)
    engine.recordInteraction({
      actorId: 'dev_2',
      itemId: 'rule:loose_regex',
      eventType: INTERACTION_TYPES.UPVOTE,
      isOrganic: false,
      dwellRatioPct: 30,
    });
    engine.recordInteraction({
      actorId: 'dev_2',
      itemId: 'rule:loose_regex',
      eventType: INTERACTION_TYPES.REVERT_UPVOTE,
      isOrganic: false,
    });

    const scoreA = engine.scoreItem('rule:fail_closed');
    const scoreB = engine.scoreItem('rule:loose_regex');

    assert.ok(scoreA > scoreB, `Expected itemA (${scoreA}) > itemB (${scoreB})`);

    // Rank for context query vector close to itemA
    const ranked = engine.rankItemsForContext([0.9, 0.1, 0.0]);
    assert.strictEqual(ranked.length, 2);
    assert.strictEqual(ranked[0].itemId, 'rule:fail_closed');
    assert.strictEqual(ranked[0].replayCount, 1);
  });
});
