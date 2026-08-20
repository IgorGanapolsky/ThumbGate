'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const hidden = require('../scripts/hidden-entry-points');

test('runHiddenEntryScorecard ranks digest and drops vendor/ISO theater', () => {
  const report = hidden.runHiddenEntryScorecard();
  assert.equal(report.schema, hidden.SCHEMA);
  assert.equal(report.summary.ok, true, report.summary.failures.join('; '));
  assert.equal(report.autoApply, false);
  assert.equal(report.humanOversightRequired, true);
  assert.equal(report.reviewVolumeIsNotTheControl, true);
  assert.equal(report.capturedRevenueUsd, 0);
  assert.equal(report.affiliation, 'none');
  assert.equal(report.iso42001Certified, false);
  assert.equal(report.process.unifiedAlertManager, false);
  assert.ok(report.digest.length < report.loadAll.length);
  assert.ok(report.digest.includes('pretooluse-unwired'));
  assert.ok(report.openAttacker.includes('dynamic-tool-ungated'));
  assert.ok(report.noiseDropped.includes('iso42001-theater'));
  assert.ok(report.noiseDropped.includes('vendor-webinar-sailpoint'));
  assert.ok(!report.digest.includes('iso42001-theater'));
  assert.ok(!report.digest.includes('vendor-webinar-sailpoint'));
});

test('rankDigest drops noise even when the theme matches identity', () => {
  const ranked = hidden.rankDigest(hidden.ENTRY_POINTS, {
    interests: ['identity'],
    maxDigest: 10,
  });
  const ids = ranked.map((e) => e.id);
  assert.ok(ids.includes('agent-identity-missing'));
  assert.ok(!ids.includes('vendor-webinar-sailpoint'));
  assert.ok(!ids.includes('iso42001-theater'));
});

test('report never claims BrightTALK, SailPoint, or ISO 42001 certification', () => {
  const report = hidden.runHiddenEntryScorecard();
  assert.equal(report.iso42001Certified, false);
  assert.equal(report.affiliation, 'none');
  assert.match(report.process.source, /not BrightTALK/i);
  assert.ok(
    report.disclaimers.some((d) => /not ISO 42001 certified/i.test(d)),
    'disclaimer must refuse ISO 42001 attestation'
  );
  const blob = JSON.stringify(report);
  assert.equal(/"iso42001Certified":\s*true/.test(blob), false);
  assert.ok(!/"affiliation":\s*"(BrightTALK|SailPoint|Strike48|Abnormal|A-LIGN)"/i.test(blob));
  assert.ok(!/we are ISO 42001/i.test(blob));
  assert.match(blob, /Review volume is not the control/);
});

test('formatReport and mainCli --json --write', () => {
  const report = hidden.runHiddenEntryScorecard();
  const md = hidden.formatReport(report);
  assert.match(md, /Hidden entry points vs interest digest/);
  assert.match(md, /Load-all webinars/);
  assert.match(md, /Interest digest/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-hidden-'));
  const out = path.join(dir, 'hidden.json');
  const code = hidden.mainCli(['--json', '--write', out]);
  assert.equal(code, 0);
  assert.ok(fs.existsSync(out));
  const parsed = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(parsed.summary.ok, true);
  assert.equal(parsed.iso42001Certified, false);
  assert.equal(parsed.capturedRevenueUsd, 0);
});

test('all-gated fixture is not a hidden-entry pass', () => {
  const closed = hidden.ENTRY_POINTS.map((e) => ({ ...e, open: false }));
  const report = hidden.runHiddenEntryScorecard({ entries: closed });
  assert.equal(report.summary.ok, false);
  assert.ok(report.summary.failures.some((f) => /not a misconfig case/.test(f)));
});

test('live overlay maps assessHookDrift onto pretooluse-unwired', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-hookless-'));
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{}\n', 'utf8');
  const report = hidden.runHiddenEntryScorecard({
    projectRoot: dir,
    homeDir: path.join(dir, 'no-home'),
  });
  assert.equal(report.mode, 'live-overlay');
  assert.ok(report.openAttacker.includes('pretooluse-unwired'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('mainCli rejects missing or flag-like values for --write and --project', () => {
  assert.equal(hidden.mainCli(['--write', '--json']), 1);
  assert.equal(hidden.mainCli(['--project', '--json']), 1);
  assert.equal(hidden.mainCli(['--write']), 1);
  assert.equal(hidden.mainCli(['--project']), 1);
});

