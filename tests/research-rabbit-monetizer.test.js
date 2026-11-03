const assert = require('node:assert');
const { ResearchRabbitMonetizer } = require('../scripts/research-rabbit-monetizer');

const monetizer = new ResearchRabbitMonetizer();

console.log('Testing ResearchRabbit Monetization Service...');
const report = monetizer.generateCitationMapAndGapAnalysis([
  'DFlash Speculative Decoding in LLMs',
  'Graph RAG Knowledge Extraction'
]);

assert.strictEqual(report.status, 'READY_TO_SELL');
assert.strictEqual(report.priceUsd, 499.00);
assert.strictEqual(report.seedCount, 2);
assert.ok(report.citationGraph.length === 2);
assert.ok(report.identifiedGaps.length > 0);
assert.strictEqual(report.monetizationLink, 'https://thumbgate.ai/diagnostic');

console.log('✅ ResearchRabbitMonetizer tests passed');
