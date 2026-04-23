const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildAwsAccessKeyId } = require('../scripts/secret-fixture-tokens');

const {
  analyzeCoverage,
  analyzeCoherence,
  computeCoherenceMetrics,
  createProbe,
  evaluateGateConfigLayer,
  evaluateSpecLayer,
  formatCoherenceReport,
  getDefaultProbes,
  runCoherenceAnalysis,
} = require('../scripts/gate-coherence');
const { validateSpec, loadSpecDir, allSpecsToGateConfigs } = require('../scripts/spec-gate');

const TEST_SPEC = {
  name: 'test-safety',
  constraints: [
    { id: 'no-force-push', scope: 'bash', deny: 'git\\s+push.*(-f|--force)', reason: 'No force push.' },
    { id: 'no-secrets', scope: 'content', deny: 'AKIA[A-Z0-9]{16}', reason: 'No AWS keys.' },
    { id: 'no-drop', scope: 'any', deny: 'DROP\\s+TABLE', reason: 'No dropping tables.' },
  ],
  invariants: [],
};

// ---------------------------------------------------------------------------
// createProbe / getDefaultProbes
// ---------------------------------------------------------------------------

test('createProbe creates a valid probe object', () => {
  const probe = createProbe('test-probe', { command: 'git push --force' }, 'dangerous');
  assert.equal(probe.id, 'test-probe');
  assert.equal(probe.input.command, 'git push --force');
  assert.equal(probe.expectedClass, 'dangerous');
});

test('getDefaultProbes returns non-empty probe set', () => {
  const probes = getDefaultProbes();
  assert.ok(probes.length >= 15, 'expected at least 15 default probes');
  assert.ok(probes.some((p) => p.expectedClass === 'dangerous'));
  assert.ok(probes.some((p) => p.expectedClass === 'safe'));
  assert.ok(probes.some((p) => p.expectedClass === 'ambiguous'));
});

// ---------------------------------------------------------------------------
// evaluateSpecLayer
// ---------------------------------------------------------------------------

test('evaluateSpecLayer blocks dangerous input', () => {
  const specs = [validateSpec(TEST_SPEC)];
  const probe = createProbe('fp', { command: 'git push --force origin main' }, 'dangerous');
  const result = evaluateSpecLayer(specs, probe);

  assert.equal(result.layerId, 'spec-gate');
  assert.equal(result.blocked, true);
  assert.ok(result.blockedBy.includes('no-force-push'));
});

test('evaluateSpecLayer passes safe input', () => {
  const specs = [validateSpec(TEST_SPEC)];
  const probe = createProbe('safe', { command: 'npm test' }, 'safe');
  const result = evaluateSpecLayer(specs, probe);

  assert.equal(result.blocked, false);
  assert.equal(result.blockedBy.length, 0);
});

// ---------------------------------------------------------------------------
// evaluateGateConfigLayer
// ---------------------------------------------------------------------------

test('evaluateGateConfigLayer blocks matching patterns', () => {
  const specs = [validateSpec(TEST_SPEC)];
  const gateConfigs = allSpecsToGateConfigs(specs);
  const probe = createProbe('fp', { command: 'git push --force origin main' }, 'dangerous');
  const result = evaluateGateConfigLayer(gateConfigs, probe);

  assert.equal(result.layerId, 'gate-config');
  assert.equal(result.blocked, true);
  assert.ok(result.blockedBy.length > 0);
});

test('evaluateGateConfigLayer passes safe input', () => {
  const specs = [validateSpec(TEST_SPEC)];
  const gateConfigs = allSpecsToGateConfigs(specs);
  const probe = createProbe('safe', { command: 'npm test' }, 'safe');
  const result = evaluateGateConfigLayer(gateConfigs, probe);

  assert.equal(result.blocked, false);
});

// ---------------------------------------------------------------------------
// analyzeCoherence
// ---------------------------------------------------------------------------

test('analyzeCoherence finds coherent results when layers agree', () => {
  const specs = [validateSpec(TEST_SPEC)];
  const gateConfigs = allSpecsToGateConfigs(specs);
  const probes = [
    createProbe('fp', { command: 'git push --force origin main' }, 'dangerous'),
    createProbe('safe', { command: 'npm test' }, 'safe'),
  ];

  const results = analyzeCoherence(specs, gateConfigs, probes);
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.allAgree));
  assert.ok(results.every((r) => r.classification === 'coherent'));
});

test('analyzeCoherence detects gaps when dangerous probes pass', () => {
  // Use a spec that doesn't catch force-push
  const weakSpec = [validateSpec({
    name: 'weak',
    constraints: [{ id: 'only-secrets', scope: 'content', deny: 'AKIA[A-Z0-9]{16}', reason: 'secrets only' }],
    invariants: [],
  })];
  const gateConfigs = allSpecsToGateConfigs(weakSpec);

  const probes = [
    createProbe('fp', { command: 'git push --force origin main' }, 'dangerous'),
  ];

  const results = analyzeCoherence(weakSpec, gateConfigs, probes);
  assert.equal(results[0].classification, 'gap');
});

// ---------------------------------------------------------------------------
// computeCoherenceMetrics
// ---------------------------------------------------------------------------

test('computeCoherenceMetrics computes unified grade for coherent results', () => {
  const specs = [validateSpec(TEST_SPEC)];
  const gateConfigs = allSpecsToGateConfigs(specs);
  const probes = [
    createProbe('fp', { command: 'git push --force origin main' }, 'dangerous'),
    createProbe('safe', { command: 'npm test' }, 'safe'),
  ];

  const results = analyzeCoherence(specs, gateConfigs, probes);
  const metrics = computeCoherenceMetrics(results);

  assert.equal(metrics.grade, 'unified');
  assert.equal(metrics.coherenceScore, 100);
  assert.equal(metrics.contradictions, 0);
  assert.equal(metrics.gaps, 0);
});

test('computeCoherenceMetrics detects divergent grade for gaps', () => {
  const mockResults = [
    { probeId: 'test', expectedClass: 'dangerous', classification: 'gap', layers: [], allAgree: true },
    { probeId: 'safe', expectedClass: 'safe', classification: 'coherent', layers: [], allAgree: true },
  ];

  const metrics = computeCoherenceMetrics(mockResults);
  assert.equal(metrics.grade, 'divergent');
  assert.equal(metrics.gaps, 1);
  assert.ok(metrics.coherenceScore < 100);
});

// ---------------------------------------------------------------------------
// analyzeCoverage
// ---------------------------------------------------------------------------

test('analyzeCoverage reports exercised and uncovered constraints', () => {
  const specs = [validateSpec(TEST_SPEC)];
  const probes = [
    createProbe('fp', { command: 'git push --force origin main' }, 'dangerous'),
    createProbe('key', { content: buildAwsAccessKeyId() }, 'dangerous'),
  ];

  const coverage = analyzeCoverage(specs, probes);
  assert.equal(coverage.totalConstraints, 3);
  assert.equal(coverage.exercised, 2); // force-push and secrets
  assert.equal(coverage.uncovered, 1); // no-drop not exercised
  assert.ok(coverage.uncoveredIds.includes('no-drop'));
});

test('analyzeCoverage returns 100% when all constraints exercised', () => {
  const specs = [validateSpec(TEST_SPEC)];
  const probes = [
    createProbe('fp', { command: 'git push --force origin main' }, 'dangerous'),
    createProbe('key', { content: buildAwsAccessKeyId() }, 'dangerous'),
    createProbe('drop', { command: 'DROP TABLE users' }, 'dangerous'),
  ];

  const coverage = analyzeCoverage(specs, probes);
  assert.equal(coverage.coverageRate, 100);
  assert.equal(coverage.uncovered, 0);
});

// ---------------------------------------------------------------------------
// runCoherenceAnalysis
// ---------------------------------------------------------------------------

test('runCoherenceAnalysis works end-to-end with default probes', () => {
  const specDir = path.join(__dirname, '..', 'config', 'specs');
  const metrics = runCoherenceAnalysis(specDir);

  assert.ok(metrics.totalProbes >= 15);
  assert.ok(metrics.coherenceScore >= 0);
  assert.ok(['unified', 'divergent', 'over-blocking'].includes(metrics.grade));
});

// ---------------------------------------------------------------------------
// formatCoherenceReport
// ---------------------------------------------------------------------------

test('formatCoherenceReport produces readable output', () => {
  const metrics = {
    totalProbes: 10,
    coherent: 8,
    contradictions: 1,
    gaps: 1,
    falsePositives: 0,
    coherenceScore: 80,
    grade: 'divergent',
    contradictionDetails: [{ probeId: 'test', expectedClass: 'dangerous', layerSummary: 'spec-gate:BLOCK | gate-config:PASS' }],
    gapDetails: [{ probeId: 'gap', expectedClass: 'dangerous' }],
    falsePositiveDetails: [],
  };

  const coverage = {
    totalConstraints: 6,
    exercised: 5,
    uncovered: 1,
    uncoveredIds: ['no-drop'],
    coverageRate: 83,
  };

  const output = formatCoherenceReport(metrics, coverage);
  assert.ok(output.includes('DIVERGENT'));
  assert.ok(output.includes('80%'));
  assert.ok(output.includes('Coverage: 83%'));
  assert.ok(output.includes('no-drop'));
  assert.ok(output.includes('Contradictions'));
});

// ---------------------------------------------------------------------------
// Integration: built-in specs pass coherence check
// ---------------------------------------------------------------------------

test('built-in agent-safety specs are coherent with default probes', () => {
  const specDir = path.join(__dirname, '..', 'config', 'specs');
  const metrics = runCoherenceAnalysis(specDir);

  assert.equal(metrics.contradictions, 0, `Contradictions found: ${JSON.stringify(metrics.contradictionDetails)}`);
  assert.equal(metrics.gaps, 0, `Gaps found: ${JSON.stringify(metrics.gapDetails)}`);
  assert.equal(metrics.grade, 'unified');
});
