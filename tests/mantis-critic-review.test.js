'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const {
  SCHEMA_VERSION,
  parseGhApiAction,
  evaluateFindings,
  evaluateCheckout,
  formatText,
} = require('../scripts/mantis-critic-review');

const mixedFindings = [
  {
    source: 'codeql',
    ruleId: 'js/sql-injection',
    file: 'scripts/billing.js',
    severity: 'error',
    reproduced: true,
    sandboxEvidence: true,
  },
  {
    source: 'codeql',
    ruleId: 'js/unused-local-variable',
    file: 'scripts/billing.js',
    severity: 'note',
  },
  {
    source: 'codeql',
    ruleId: 'js/sql-injection',
    file: 'scripts/billing.js',
    severity: 'error',
    reproduced: true,
  },
];

test('parseGhApiAction uses the positional path, not a field-value substring', () => {
  const patchExisting = parseGhApiAction(
    'gh api repos/IgorGanapolsky/ThumbGate/pulls/3702 -X PATCH -f title=/pulls/3702',
  );
  assert.equal(patchExisting.parsed, true);
  assert.equal(patchExisting.method, 'patch');
  assert.equal(patchExisting.endpoint, 'repos/IgorGanapolsky/ThumbGate/pulls/3702');
  assert.equal(patchExisting.isPrCreate, false);

  const create = parseGhApiAction(
    'gh api repos/IgorGanapolsky/ThumbGate/pulls -X POST -f title=hello',
  );
  assert.equal(create.isPrCreate, true);
  assert.equal(create.endpoint, 'repos/IgorGanapolsky/ThumbGate/pulls');
});

test('rule-based critic keeps low-risk as needs_review and dedupes; does not auto-FP', () => {
  const report = evaluateFindings({ findings: mixedFindings });
  assert.equal(report.decision, 'allow');
  assert.deepEqual(report.issues, []);
  assert.equal(report.verdicts[0].verdict, 'confirmed');
  assert.equal(report.verdicts[1].verdict, 'needs_review');
  assert.equal(report.verdicts[2].verdict, 'duplicate');
  assert.equal(report.verdicts[1].autoFp, false);
  assert.equal(report.duplicateCount, 1);
  assert.equal(report.needsReviewCount, 1);
  assert.match(report.claimBoundary, /not a live Mantis/i);
});

test('auto-FP of low-risk findings is a deny (Mantis negative-filter discipline)', () => {
  const report = evaluateFindings({ findings: mixedFindings, autoFpLowRisk: true });
  assert.equal(report.decision, 'deny');
  assert.ok(report.issues.includes('auto_fp_low_risk'));
});

test('per-finding autoFp on a note is a deny and the note is still not dropped as FP', () => {
  const report = evaluateFindings({
    findings: [{
      source: 'codeql',
      ruleId: 'js/unused-local-variable',
      file: 'scripts/billing.js',
      severity: 'note',
      autoFp: true,
    }],
  });
  assert.equal(report.decision, 'deny');
  assert.ok(report.issues.includes('auto_fp_low_risk'));
  assert.equal(report.verdicts[0].verdict, 'needs_review');
  assert.equal(report.verdicts[0].dropped, false);
});

test('matching a gate on a field-value substring is a deny', () => {
  const report = evaluateFindings({
    findings: [{
      source: 'gate',
      ruleId: 'gh-api-pr-create-restricted',
      file: 'scripts/gates-engine.js',
      severity: 'high',
      command: 'gh api repos/o/r/pulls/3702 -X PATCH -f title=/pulls/3702',
      matchedOnFieldValue: true,
    }],
  });
  assert.equal(report.decision, 'deny');
  assert.ok(report.issues.includes('substring_not_action'));
});

test('POST /pulls is a real create action and does not trip substring_not_action', () => {
  const report = evaluateFindings({
    findings: [{
      source: 'gate',
      ruleId: 'gh-api-pr-create-restricted',
      file: 'scripts/gates-engine.js',
      severity: 'high',
      command: 'gh api repos/o/r/pulls -X POST -f title=hello',
      reproduced: true,
    }],
  });
  assert.equal(report.decision, 'allow');
  assert.equal(report.verdicts[0].verdict, 'confirmed');
  assert.equal(
    parseGhApiAction('gh api repos/o/r/pulls -X POST -f title=hello').isPrCreate,
    true,
  );
});

test('brute-force file scan without hierarchical summaries fails closed', () => {
  const report = evaluateFindings({
    findings: mixedFindings,
    bruteForceScan: true,
    rawFileDump: true,
  });
  assert.equal(report.decision, 'deny');
  assert.ok(report.issues.includes('brute_force_scan'));
  assert.ok(report.issues.includes('missing_hierarchical_summary'));
});

test('LLM saying a finding is a false positive is not grounding', () => {
  const report = evaluateFindings({
    findings: mixedFindings,
    modelSaidFalsePositive: true,
  });
  assert.equal(report.decision, 'deny');
  assert.ok(report.issues.includes('llm_judgment_not_grounding'));
});

test('promoting a high finding to a rule without reproduction fails closed', () => {
  const report = evaluateFindings({
    findings: [{
      source: 'socket',
      ruleId: 'CWE-78',
      file: 'scripts/run.js',
      severity: 'critical',
    }],
    promoteToRule: true,
  });
  assert.equal(report.decision, 'deny');
  assert.ok(report.issues.includes('promote_without_reproduction'));
  assert.equal(report.verdicts[0].verdict, 'needs_reproduction');
});

test('missing findings inventory fails closed', () => {
  const report = evaluateFindings({});
  assert.equal(report.decision, 'deny');
  assert.ok(report.issues.includes('findings_inventory_unavailable'));
});

test('missing source/rule/file is missing_finding_context', () => {
  const report = evaluateFindings({ findings: [{ severity: 'high' }] });
  assert.equal(report.decision, 'deny');
  assert.ok(report.issues.includes('missing_finding_context'));
});

test('model saying the batch is safe is not a grant', () => {
  const report = evaluateFindings({ findings: mixedFindings, modelSaidSafe: true });
  assert.equal(report.decision, 'deny');
  assert.ok(report.issues.includes('model_cannot_grant_authority'));
});

test('default checkout maps existing scanner/gate rails and does not claim Mantis', () => {
  const report = evaluateCheckout();
  assert.equal(report.schemaVersion, `${SCHEMA_VERSION}.checkout`);
  assert.equal(report.affiliation, 'none');
  assert.equal(report.livePromotionAllowed, false);
  assert.equal(report.decision, 'allow');
  assert.equal(report.items.find((row) => row.id === 'existing_security_scanner').status, 'pass');
  assert.equal(report.items.find((row) => row.id === 'action_not_substring').status, 'pass');
  assert.equal(report.items.find((row) => row.id === 'required_codeql_workflow').status, 'pass');
  assert.equal(report.items.find((row) => row.id === 'google_mantis_harness').status, 'not_wired');
  assert.equal(report.items.find((row) => row.id === 'llm_adjudicator_sku').status, 'not_wired');
  assert.match(report.claimBoundary, /not google\/mantis/i);
});

test('claimLive is refused', () => {
  const report = evaluateCheckout({ claimLive: true });
  assert.equal(report.decision, 'deny');
  assert.ok(report.liveBlockedReasons.includes('claimLive_refused_without_mantis_runtime'));
});

test('formatText deny path does not throw', () => {
  const text = formatText(evaluateFindings({}));
  assert.match(text, /decision=deny/);
  assert.doesNotMatch(text, /TypeError/);
});

test('CLI default checkout exits 0 and names Google Mantis as not-us', () => {
  const cli = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'mantis-critic-review.js'),
  ], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr + cli.stdout);
  assert.match(cli.stdout, /Google Mantis/);
  assert.match(cli.stdout, /not_wired/);
});

test('CLI --decide auto-FP exits 2', () => {
  const cli = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'mantis-critic-review.js'),
    '--decide',
    JSON.stringify({ findings: mixedFindings, autoFpLowRisk: true }),
  ], { encoding: 'utf8' });
  assert.equal(cli.status, 2, cli.stderr + cli.stdout);
  assert.match(cli.stdout, /auto_fp_low_risk/);
});

test('CLI --decide without payload exits 2', () => {
  const cli = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'mantis-critic-review.js'),
    '--decide',
  ], { encoding: 'utf8' });
  assert.equal(cli.status, 2, cli.stderr + cli.stdout);
  assert.match(cli.stdout, /missing_decide_payload/);
});

test('CLI --claim-live before --decide denies even on a clean payload', () => {
  const cli = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'mantis-critic-review.js'),
    '--claim-live',
    '--decide',
    JSON.stringify({ findings: mixedFindings }),
  ], { encoding: 'utf8' });
  assert.equal(cli.status, 2, cli.stderr + cli.stdout);
  assert.match(cli.stdout, /decision=deny/);
  assert.match(cli.stdout, /Refused: this doctor cannot become Google Mantis/);
  assert.doesNotMatch(cli.stdout, /decision=allow/);
});

test('CLI --decide= empty payload exits 2', () => {
  const cli = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'mantis-critic-review.js'),
    '--decide=',
  ], { encoding: 'utf8' });
  assert.equal(cli.status, 2, cli.stderr + cli.stdout);
  assert.match(cli.stdout, /missing_decide_payload/);
});

test('mantis-critic-review stays checkout-only (script_not_in_pack_ok)', () => {
  const pkg = require('../package.json');
  const files = pkg.files || [];
  assert.equal(
    files.includes('scripts/mantis-critic-review.js'),
    false,
    'do not pack this doctor; unique-file successor must not bump the npm bundle ratchet',
  );
  assert.equal(pkg.scripts['mantis:critic-review'], 'node scripts/mantis-critic-review.js');
  assert.equal(
    files.includes('scripts/mantis-vulnerability-scanner.js'),
    false,
    'never pack the untracked Mantis-clone theater',
  );
});
