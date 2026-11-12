const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-gov-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

const gov = require('../scripts/data-governance');

test.after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

// === Preferences ===
test('DEFAULT_PREFERENCES has all required fields', () => {
  assert.ok('allowDpoExport' in gov.DEFAULT_PREFERENCES);
  assert.ok('allowSlowLoopTraining' in gov.DEFAULT_PREFERENCES);
  assert.ok('piiRedactionEnabled' in gov.DEFAULT_PREFERENCES);
  assert.ok('maxExportSensitivity' in gov.DEFAULT_PREFERENCES);
  assert.ok('retentionDays' in gov.DEFAULT_PREFERENCES);
  assert.equal(gov.DEFAULT_PREFERENCES.retentionDays, 90);
});

test('loadPreferences returns defaults when no file', () => {
  const p = gov.loadPreferences();
  assert.equal(p.allowDpoExport, true);
  assert.equal(p.piiRedactionEnabled, true);
});

test('savePreferences persists to disk', () => {
  const saved = gov.savePreferences({ allowDpoExport: false });
  assert.equal(saved.allowDpoExport, false);
  assert.ok(saved.updatedAt);
  assert.ok(fs.existsSync(gov.getPreferencesPath()));
  const loaded = gov.loadPreferences();
  assert.equal(loaded.allowDpoExport, false);
});

test('updatePreference updates single field', () => {
  const p = gov.updatePreference('retentionDays', 30);
  assert.equal(p.retentionDays, 30);
  assert.equal(gov.loadPreferences().retentionDays, 30);
});

test('updatePreference throws for unknown key', () => {
  assert.throws(() => gov.updatePreference('badKey', true), /Unknown preference/);
});

test('updatePreference throws for version field', () => {
  assert.throws(() => gov.updatePreference('version', 99), /Cannot modify version/);
});

// === Operation Checks ===
test('isOperationAllowed respects preferences', () => {
  gov.savePreferences({ allowDpoExport: false, allowSlowLoopTraining: true });
  assert.equal(gov.isOperationAllowed('dpo_export'), false);
  assert.equal(gov.isOperationAllowed('slow_loop'), true);
  assert.equal(gov.isOperationAllowed('unknown_op'), true);
});

// === Governed DPO Export ===
test('governedDpoExport blocks when preference disabled', () => {
  gov.savePreferences({ allowDpoExport: false });
  const r = gov.governedDpoExport([{ prompt: 'x', chosen: 'y', rejected: 'z' }]);
  assert.equal(r.allowed, false);
  assert.equal(r.pairs.length, 0);
  assert.ok(r.reason.includes('disabled'));
});

test('governedDpoExport passes clean pairs with PII redaction', () => {
  gov.savePreferences({ allowDpoExport: true, piiRedactionEnabled: true });
  const pairs = [{ prompt: 'Fix bug', chosen: 'Fixed deploy', rejected: 'Skipped tests' }];
  const r = gov.governedDpoExport(pairs);
  assert.equal(r.allowed, true);
  assert.equal(r.pairs.length, 1);
  assert.equal(r.blocked, 0);
});

test('governedDpoExport blocks pairs with PII', () => {
  gov.savePreferences({ allowDpoExport: true, maxExportSensitivity: 'internal' });
  const pairs = [
    { prompt: 'Fix', chosen: 'Done', rejected: 'No' },
    { prompt: 'Update', chosen: 'Contact john@evil.com', rejected: 'Skip' },
  ];
  const r = gov.governedDpoExport(pairs);
  assert.equal(r.pairs.length, 1);
  assert.equal(r.blocked, 1);
});

test('governedDpoExport redacts PII in passing pairs', () => {
  gov.savePreferences({ allowDpoExport: true, piiRedactionEnabled: true, maxExportSensitivity: 'sensitive' });
  const pairs = [{ prompt: 'Fix', chosen: 'Email john@test.com worked', rejected: 'No' }];
  const r = gov.governedDpoExport(pairs);
  assert.equal(r.pairs.length, 1);
  assert.ok(r.pairs[0].chosen.includes('[REDACTED:email]'));
});

// === Retention ===
test('enforceRetention purges old entries', () => {
  const logPath = path.join(tmpDir, 'feedback-log.jsonl');
  const old = { timestamp: '2020-01-01T00:00:00Z', id: 'old' };
  const fresh = { timestamp: new Date().toISOString(), id: 'fresh' };
  fs.writeFileSync(logPath, JSON.stringify(old) + '\n' + JSON.stringify(fresh) + '\n');
  gov.savePreferences({ retentionDays: 90 });
  const r = gov.enforceRetention();
  assert.equal(r.purged, 1);
  assert.equal(r.remaining, 1);
});

test('enforceRetention handles empty log', () => {
  fs.unlinkSync(path.join(tmpDir, 'feedback-log.jsonl'));
  assert.equal(gov.enforceRetention().purged, 0);
});

// === Data Usage Summary ===
test('generateDataUsageSummary returns compliance fields', () => {
  fs.writeFileSync(path.join(tmpDir, 'feedback-log.jsonl'), '{"id":"1"}\n{"id":"2"}\n');
  gov.savePreferences({ allowDpoExport: true, piiRedactionEnabled: true, retentionDays: 60 });
  const s = gov.generateDataUsageSummary();
  assert.equal(s.dataStorageLocation, 'local-only (on-device)');
  assert.equal(s.phonesHome, false);
  assert.equal(s.feedbackEntries, 2);
  assert.equal(s.compliance.localFirst, true);
  assert.equal(s.compliance.piiScanning, true);
  assert.equal(s.compliance.dataRetention, '60 days');
  assert.equal(s.preferences.dpoExport, 'enabled');
  assert.ok(s.generatedAt);
});

test('generateDataUsageSummary reflects disabled preferences', () => {
  gov.savePreferences({ allowDpoExport: false, piiRedactionEnabled: false });
  const s = gov.generateDataUsageSummary();
  assert.equal(s.preferences.dpoExport, 'disabled');
  assert.equal(s.preferences.piiRedaction, 'disabled');
  assert.ok(s.compliance.exportGating.includes('disabled'));
});

// === Capital One / Gartner Symposium 2026 AI Risk & Business Value Controls ===
test('governedDpoExport with tokenizeAtSource preserves referential integrity across turns without dropping PII pairs', () => {
  gov.savePreferences({ allowDpoExport: true, piiRedactionEnabled: true, maxExportSensitivity: 'internal' });
  const salt = 'gartner-2026-dpo-source-tokenization-key';
  const pairs = [{
    prompt: 'Investigate billing failure for buyer@acmecorp.com (SSN 123 45 6789, phone +1-415-890-1234, acct 123456789012)',
    chosen: 'Verified account for buyer@acmecorp.com without printing SSN 123 45 6789 or +1-415-890-1234',
    rejected: 'Emailed raw SSN 123 45 6789 to buyer@acmecorp.com',
  }];

  const exported = gov.governedDpoExport(pairs, { tokenizeAtSource: true, salt });
  assert.equal(exported.allowed, true);
  assert.equal(exported.blocked, 0);
  assert.equal(exported.pairs.length, 1);
  assert.equal(exported.piiStats.protectionMode, 'source_format_preserving_tokenization');

  const [outPair] = exported.pairs;
  assert.ok(!outPair.prompt.includes('buyer@acmecorp.com'));
  assert.ok(!outPair.prompt.includes('123 45 6789'));
  assert.ok(!outPair.prompt.includes('415-890-1234'));
  assert.ok(!outPair.prompt.includes('123456789012'), 'untokenized AWS account ID still scrubbed by redactPii');
  assert.ok(outPair.prompt.includes('[REDACTED:aws_account]'));
  assert.match(outPair.prompt, /\+1-555-01\d-\d{4}/, 'country-prefixed US phone tokenized and preserved past redactPii');
  const promptEmailToken = outPair.prompt.match(/tok_[0-9a-f]{8}@tokenized\.local/)?.[0];
  assert.ok(promptEmailToken);
  assert.ok(outPair.chosen.includes(promptEmailToken), 'chosen turn preserves exact same email token');
  assert.ok(outPair.rejected.includes(promptEmailToken), 'rejected turn preserves exact same email token');
});

test('evaluateInferenceParadoxGuard shifts from tokenmaxxing to valuemaxxing and opens circuit on public cost-exhaustion', () => {
  const runaway = gov.evaluateInferenceParadoxGuard({
    baselineTaskTokens: 2000,
    agentWorkflowTokens: 70000,
    annualBudgetUsd: 120000,
    spendToDateUsd: 120000,
    elapsedMonths: 4,
    publicFacing: true,
    requestsPerMinute: 240,
    maxPublicRpm: 60,
    positiveReturnVerified: false,
  });
  assert.equal(runaway.tokenAmplificationRatio, 35);
  assert.equal(runaway.projectedExhaustionMonths, 4);
  assert.equal(runaway.budgetBurnAlert, true);
  assert.equal(runaway.costExhaustionRisk, true);
  assert.equal(runaway.circuitState, 'OPEN');
  assert.equal(runaway.operatingMode, 'tokenmaxxing_contained');
  assert.equal(runaway.allowScaleOut, false);
  assert.deepEqual(runaway.blockers, [
    'cost_exhaustion_circuit_open',
    'runaway_agent_token_amplification',
    'annual_budget_exhaustion_trajectory',
    'unverified_roi_scale_out_blocked',
  ]);

  const governed = gov.evaluateInferenceParadoxGuard({
    baselineTaskTokens: 2000,
    agentWorkflowTokens: 16000,
    annualBudgetUsd: 120000,
    spendToDateUsd: 25000,
    elapsedMonths: 4,
    publicFacing: true,
    requestsPerMinute: 25,
    maxPublicRpm: 60,
    positiveReturnVerified: true,
  });
  assert.equal(governed.tokenAmplificationRatio, 8);
  assert.equal(governed.inGartnerAgentMultiplierBand, true);
  assert.equal(governed.circuitState, 'CLOSED');
  assert.equal(governed.operatingMode, 'valuemaxxing');
  assert.equal(governed.allowScaleOut, true);
  assert.deepEqual(governed.blockers, []);
  const infiniteBudget = gov.evaluateInferenceParadoxGuard({ annualBudgetUsd: Infinity, spendToDateUsd: 100, elapsedMonths: 1, positiveReturnVerified: true });
  assert.equal(infiniteBudget.projectedExhaustionMonths, null);
});

test('evaluateGartnerAgenticGovernanceRecord enforces AI Custodian, Shadow AI, Dark AI, zero-bypass, and NIST 2030/2035 PQC countdown', () => {
  const failing = gov.evaluateGartnerAgenticGovernanceRecord({
    custodianOwner: '',
    registeredAgents: ['claude-prod'],
    observedAgents: ['claude-prod', 'personal-shadow-bot'],
    darkAiEvents: ['sandbox_escape_probe'],
    bypassAttempts: 2,
    cryptoAlgorithms: ['RS256', 'ECDSA-P256', 'ML-DSA-65'],
    currentYear: 2026,
  });
  assert.equal(failing.compliant, false);
  assert.equal(failing.custodianAssigned, false);
  assert.deepEqual(failing.shadowAiAgents, ['personal-shadow-bot']);
  assert.deepEqual(failing.darkAiIncidents, ['sandbox_escape_probe']);
  assert.equal(failing.paperworkOnlyRisk, true);
  assert.equal(failing.classicalCryptoMigrationRequired, true);
  assert.equal(failing.pqcCountdown[0].deprecatedByYear, 2030);
  assert.equal(failing.pqcCountdown[0].disallowedByYear, 2035);
  assert.equal(failing.pqcCountdown[0].yearsUntilDeprecation, 4);
  assert.equal(failing.pqcCountdown[2].classicalPublicKeyVulnerable, false);
  assert.deepEqual(failing.blockers, [
    'missing_accountable_ai_custodian',
    'unregistered_shadow_ai_detected',
    'dark_ai_rogue_or_sandbox_escape_detected',
    'paperwork_only_governance_bypass_detected',
  ]);

  const passing = gov.evaluateGartnerAgenticGovernanceRecord({
    custodianOwner: 'cio@enterprise.io',
    registeredAgents: ['claude-prod', 'omp-worker'],
    observedAgents: ['claude-prod', 'omp-worker'],
    darkAiEvents: [],
    bypassAttempts: 0,
    cryptoAlgorithms: ['ML-KEM-768', 'AES-256-GCM'],
    currentYear: 2026,
  });
  assert.equal(passing.compliant, true);
  assert.equal(passing.custodianOwner, 'cio@enterprise.io');
  assert.equal(passing.classicalCryptoMigrationRequired, false);
  assert.deepEqual(passing.blockers, []);
});
