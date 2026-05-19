'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { defragAgentMemories } = require('../scripts/memory-defrag');

test('memory-defrag', async (t) => {
  await t.test('passes through single memory', () => {
    const input = [{ id: '1', scope: 'auth', text: 'Auth fixed', importance: 0.9 }];
    const res = defragAgentMemories(input);
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].id, '1');
  });

  await t.test('compacts low-importance memories', () => {
    const input = [
      { id: '1', scope: 'auth', text: 'Auth fixed', importance: 0.9 },
      { id: '2', scope: 'auth', text: 'Minor typo', importance: 0.3 },
      { id: '3', scope: 'auth', text: 'Added log', importance: 0.4 },
    ];
    const res = defragAgentMemories(input, 0.8);
    
    assert.strictEqual(res.length, 2); // 1 kept, 1 merged
    const merged = res.find(m => m.type === 'consolidated_summary');
    assert.ok(merged);
    assert.deepStrictEqual(merged.supersedes, ['3', '2']);
    assert.strictEqual(merged.importance, 0.4); // max of merged
  });
});
