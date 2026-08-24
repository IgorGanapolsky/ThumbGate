'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  ACTION_SPACE,
  DEFAULT_PANEL_PATH,
  SCHEMA_VERSION,
  chooseAction,
  formatText,
  ingestObservations,
  loadPanel,
  rankVariants,
  retrieveEvidence,
  runPanel,
  runScenarios,
  scorePersonaVariant,
  stepAgent,
  validatePanel,
} = require('../scripts/synthetic-customer-panel');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('default panel is a narrow decision with 10 evidence-backed personas and 3 variants', () => {
  const panel = loadPanel();
  assert.equal(panel.schemaVersion, SCHEMA_VERSION);
  assert.equal(panel.decision.intervention, 'landing-page angle');
  assert.equal(panel.decision.outcomeMetric, 'qualified_install_intent');
  assert.notEqual(panel.decision.outcomeMetric, 'diagnostic_499_checkout');
  assert.equal(panel.personas.length, 10);
  assert.equal(panel.variants.length, 3);
  assert.deepEqual(panel.variants.map((row) => row.id).sort(), [
    'cost-loop',
    'preaction-block',
    'proof-first',
  ]);
  const validation = validatePanel(panel);
  assert.equal(validation.ok, true, validation.issues.join('\n'));
  assert.equal(panel.observations.length, 0);
});

test('every persona has the durable schema, irrationality, and observed evidence with source+timestamp', () => {
  const panel = loadPanel();
  for (const persona of panel.personas) {
    assert.ok(persona.observedVsStated);
    assert.ok(persona.biases.overclaimAllergy !== undefined);
    assert.ok(persona.biases.comparisonShopping !== undefined);
    assert.deepEqual([...persona.actionSpace].sort(), [...ACTION_SPACE].sort());
    const evidence = retrieveEvidence(persona, panel);
    assert.ok(evidence.length >= 1, persona.id);
    assert.equal(evidence[0].kind, 'observed');
    assert.ok(evidence[0].sourceId);
    assert.ok(evidence[0].observedAt);
  }
});

test('agent loop captures choice, reasoning, confidence, objections, memory, and next action', () => {
  const panel = loadPanel();
  const persona = panel.personas.find((row) => row.id === 'skeptical-comparison-shopper');
  const variant = panel.variants.find((row) => row.id === 'proof-first');
  const run = stepAgent(persona, variant, panel.contexts[1], panel);
  assert.equal(run.personaId, persona.id);
  assert.ok(ACTION_SPACE.includes(run.action));
  assert.ok(run.reasoning.includes('retrieved'));
  assert.ok(run.confidence > 0 && run.confidence <= 1);
  assert.ok(run.objections.length >= 1);
  assert.ok(run.memory.includes('saw:proof-first@comparison_page'));
  assert.ok(run.environment.headline);
  assert.ok(run.nextAction);
});

test('default run ranks alternatives but stays a hypothesis', () => {
  const panel = loadPanel();
  const result = runPanel(panel);
  assert.equal(result.runDecision, 'allow');
  assert.equal(result.deploymentDecision, 'deny');
  assert.equal(result.modeledNotMeasured, true);
  assert.equal(result.evaluation.evidenceGrade, 'modeledNotMeasured');
  assert.equal(result.evaluation.livePromotionAllowed, false);
  assert.equal(result.runs.length, 10 * 3 * 3);
  assert.equal(result.ranked.length, 3);
  assert.equal(result.ranked[0].modeledNotMeasured, true);
  assert.equal(result.scoring, 'labeled_heuristic_not_a_trained_model');
  assert.equal(result.fineTune.allowed, false);
  assert.match(result.recommendation.hypothesis, /validate with a 10–20% traffic split/);
  assert.match(result.recommendation.hypothesis, /modeledNotMeasured/);
  assert.doesNotMatch(result.recommendation.hypothesis, /agents say .* wins/i);
  assert.equal(result.recommendation.liveExperiment.status, 'recommended_not_launched');
  const text = formatText(result);
  assert.match(text, /hypothesis, not observed conversion lift/);
});

test('proof-first is predicted for the skeptical comparison shopper because it reduces perceived risk', () => {
  const panel = loadPanel();
  const result = runPanel(panel);
  const segment = result.segments.find((row) => row.personaId === 'skeptical-comparison-shopper');
  assert.equal(segment.predictedVariantId, 'proof-first');
  assert.match(segment.because, /risk|receipt|compar/i);
  const skeptic = panel.personas.find((row) => row.id === 'skeptical-comparison-shopper');
  const proof = panel.variants.find((row) => row.id === 'proof-first');
  const hero = panel.variants.find((row) => row.id === 'preaction-block');
  const proofScore = scorePersonaVariant(skeptic, proof, 'comparison_page');
  const heroScore = scorePersonaVariant(skeptic, hero, 'comparison_page');
  assert.ok(proofScore > heroScore);
  assert.equal(chooseAction(heroScore, skeptic, hero) !== 'opt_in' || heroScore < proofScore, true);
});

test('cost-loop is the predicted angle for the token-burn operator', () => {
  const panel = loadPanel();
  const result = runPanel(panel);
  const segment = result.segments.find((row) => row.personaId === 'token-burn-operator');
  assert.equal(segment.predictedVariantId, 'cost-loop');
  const persona = panel.personas.find((row) => row.id === 'token-burn-operator');
  const cost = panel.variants.find((row) => row.id === 'cost-loop');
  const hero = panel.variants.find((row) => row.id === 'preaction-block');
  assert.ok(
    scorePersonaVariant(persona, cost, 'ad_click')
      > scorePersonaVariant(persona, hero, 'ad_click'),
  );
});

test('time-starved lead prefers the faster preaction-block CTA', () => {
  const panel = loadPanel();
  const result = runPanel(panel);
  const segment = result.segments.find((row) => row.personaId === 'time-starved-lead');
  assert.equal(segment.predictedVariantId, 'preaction-block');
});

test('fixture observations can score ranking math without becoming a live winner', () => {
  const panel = loadPanel();
  const result = runPanel(panel);
  const observations = [];
  for (const persona of panel.personas) {
    for (const variant of panel.variants) {
      const mean = result.runs
        .filter((run) => run.personaId === persona.id && run.variantId === variant.id)
        .reduce((sum, run, _, all) => sum + run.score / all.length, 0);
      observations.push({
        personaId: persona.id,
        variantId: variant.id,
        outcome: mean,
        kind: 'fixture',
        sourceId: 'tests/synthetic-customer-panel.test.js',
        observedAt: '2026-08-24T00:00:00.000Z',
      });
    }
  }
  const scored = runPanel(panel, {
    observations,
    allowFixture: true,
    holdoutPersonaIds: panel.personas.map((row) => row.id),
  });
  assert.equal(scored.evaluation.fixtureCount, 30);
  assert.equal(scored.evaluation.observedCount, 0);
  assert.ok(scored.evaluation.holdoutPairwiseAccuracy >= 0.99);
  assert.equal(scored.evaluation.livePromotionAllowed, false);
  assert.equal(scored.deploymentDecision, 'deny');
});

test('kind=observed holdout that matches the ranking still refuses conversion-lift language', () => {
  const panel = loadPanel();
  const preview = runPanel(panel);
  const observations = [];
  for (const persona of panel.personas.slice(0, 5)) {
    for (const variant of panel.variants) {
      const mean = preview.runs
        .filter((run) => run.personaId === persona.id && run.variantId === variant.id)
        .reduce((sum, run, _, all) => sum + run.score / all.length, 0);
      observations.push({
        personaId: persona.id,
        variantId: variant.id,
        outcome: mean,
        kind: 'observed',
        sourceId: 'holdout-campaign-replay',
        observedAt: '2026-08-24T00:00:00.000Z',
      });
    }
  }
  const scored = runPanel(panel, {
    observations,
    holdoutPersonaIds: panel.personas.slice(0, 5).map((row) => row.id),
  });
  assert.equal(scored.evaluation.livePromotionAllowed, true);
  assert.equal(scored.deploymentDecision, 'allow');
  assert.match(scored.recommendation.claimBoundary, /not observed conversion lift/);
  assert.equal(scored.recommendation.liveExperiment.status, 'holdout_passed_still_needs_monitored_rollout');
});

test('ingestObservations refuses unlabeled or non-numeric rows', () => {
  assert.throws(() => ingestObservations([{ personaId: 'a', variantId: 'b', outcome: 1 }]), /kind=observed/);
  assert.throws(
    () => ingestObservations([{ personaId: 'a', variantId: 'b', outcome: 'win', kind: 'observed' }]),
    /numeric/,
  );
  const rows = ingestObservations([
    { personaId: 'a', variantId: 'b', outcome: 1, kind: 'fixture' },
  ], { allowFixture: true });
  assert.equal(rows[0].kind, 'fixture');
});

test('validatePanel fails closed without intervention, personas, or observed evidence', () => {
  const panel = loadPanel();
  const empty = runPanel({ decision: {}, personas: [], variants: [] });
  assert.equal(empty.runDecision, 'deny');
  assert.ok(empty.validation.issues.includes('missing_intervention'));

  const stripped = clone(panel);
  stripped.personas[0].evidenceIds = [];
  const invalid = validatePanel(stripped);
  assert.equal(invalid.ok, false);
  assert.ok(invalid.issues.some((issue) => issue.startsWith('persona_missing_observed_evidence')));
});

test('ranking is deterministic across identical runs', () => {
  const panel = loadPanel();
  const first = rankVariants(panel, runScenarios(panel));
  const second = rankVariants(panel, runScenarios(panel));
  assert.deepEqual(first.map((row) => row.variantId), second.map((row) => row.variantId));
  assert.deepEqual(first.map((row) => row.meanScore), second.map((row) => row.meanScore));
});

test('CLI prints the hypothesis form and exits 0 on the default panel', () => {
  const cli = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'synthetic-customer-panel.js')], {
    encoding: 'utf8',
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /validate with a 10–20% traffic split/);
  assert.match(cli.stdout, /modeledNotMeasured/);
  assert.match(cli.stdout, /not observed conversion lift or a production winner/);
  assert.doesNotMatch(cli.stdout, /the agents say/i);
});

test('CLI --observations loads labels without inventing them', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-obs-'));
  const file = path.join(dir, 'obs.json');
  fs.writeFileSync(file, JSON.stringify([
    {
      personaId: 'token-burn-operator',
      variantId: 'cost-loop',
      outcome: 1,
      kind: 'fixture',
      sourceId: 'tmp',
      observedAt: '2026-08-24T00:00:00.000Z',
    },
  ]));
  const cli = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'synthetic-customer-panel.js'),
    '--json',
    `--observations=${file}`,
  ], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(cli.status, 0, cli.stderr);
  const payload = JSON.parse(cli.stdout);
  assert.equal(payload.evaluation.fixtureCount, 1);
  assert.equal(payload.modeledNotMeasured, true);
});

test('default panel file is the committed eval artifact, not a prompt dump', () => {
  assert.equal(path.basename(DEFAULT_PANEL_PATH), 'panel.json');
  assert.match(DEFAULT_PANEL_PATH, /evals\/synthetic-customer-panel/);
  const spec = fs.readFileSync(path.join(__dirname, '..', 'evals', 'synthetic-customer-panel', 'SPEC.md'), 'utf8');
  assert.match(spec, /qualified_install_intent/);
  assert.match(spec, /modeledNotMeasured/);
});
