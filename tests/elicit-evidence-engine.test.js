const assert = require('node:assert');
const { ElicitEvidenceEngine } = require('../scripts/elicit-evidence-engine');

const engine = new ElicitEvidenceEngine();

// 1. Add Sources to Library
console.log('Testing Source Library & Sentence-Level Citations...');
engine.addSource('doc_1', {
  title: 'MEMS Temperature Drift Mitigation',
  text: 'Temperature drift in MEMS sensors can be effectively reduced by active dual-reference calibration.',
  authors: ['Smith et al.'],
  year: 2025
});

engine.addSource('doc_2', {
  title: 'Energy-Latency Trade-offs in Gesture Recognition',
  text: 'Optimizing quantization parameters reduces neural network latency by 42% without significant accuracy loss.',
  authors: ['Doe et al.'],
  year: 2026
});

// 2. Synthesize with Citations
const synthesis = engine.synthesizeWithCitations(
  'How to mitigate temperature drift and optimize gesture latency?',
  ['doc_1', 'doc_2']
);

assert.strictEqual(synthesis.status, 'VERIFIED_SYNTHESIS');
assert.strictEqual(synthesis.claimsCount, 2);
assert.strictEqual(synthesis.synthesizedReport[0].citation.sourceId, 'doc_1');
assert.ok(synthesis.synthesizedReport[0].citation.exactSnippet.length > 0);

// 3. Routines
console.log('Testing Continuous Research Routines...');
engine.registerRoutine('rout_001', {
  query: 'Latest advancements in DFlash speculative decoding',
  frequency: 'daily'
});

const routineResults = engine.runRoutines();
assert.strictEqual(routineResults.length, 1);
assert.strictEqual(routineResults[0].status, 'CHECKED_NEW_EVIDENCE');

console.log('✅ ElicitEvidenceEngine tests passed');
