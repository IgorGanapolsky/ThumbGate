const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-gov-'));
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
