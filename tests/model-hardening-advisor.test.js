const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeHardeningNeeds } = require('../scripts/model-hardening-advisor');

test('analyzeHardeningNeeds recommends LoRA for frequent failures', () => {
  const log = Array(6).fill({ signal: 'negative', category: 'git' });
  const result = analyzeHardeningNeeds(log);
  const git = result.find(r => r.category === 'git');
  assert.equal(git.strategy, 'LoRA Fine-tuning');
});

test('analyzeHardeningNeeds recommends gates for sparse failures', () => {
  const log = [{ signal: 'negative', category: 'sql' }];
  const result = analyzeHardeningNeeds(log);
  const sql = result.find(r => r.category === 'sql');
  assert.equal(sql.strategy, 'In-Context Guardrails');
});
