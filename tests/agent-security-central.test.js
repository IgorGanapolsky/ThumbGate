'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildSecurityCentralReport,
  formatSecurityCentralReport,
  assessHookDrift,
  assessPrivilegedCoverage,
  assessPolicyVariance,
  assessSensitiveAudit,
  assessMcpThumbgate,
  scorePosture,
  PRIVILEGED_COVERAGE,
} = require('../scripts/agent-security-central');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('PRIVILEGED_COVERAGE lists five high-blast categories (Oracle-style access risk map)', () => {
  assert.equal(PRIVILEGED_COVERAGE.length, 5);
  assert.ok(PRIVILEGED_COVERAGE.every((c) => c.id && c.label && c.match));
});

test('assessHookDrift flags missing PreToolUse thumbgate markers', () => {
  const dir = tmpDir('tg-sec-hooks-');
  const home = tmpDir('tg-sec-home-');
  try {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.claude', 'settings.json'),
      JSON.stringify({ hooks: { PreToolUse: [] } }),
    );
    const r = assessHookDrift(dir, home);
    assert.equal(r.drifted, true);
    assert.equal(r.anyThumbgateHook, false);
    assert.ok(r.findings.some((f) => f.id === 'hook-drift-missing-thumbgate'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('assessHookDrift accepts gate-check in PreToolUse command', () => {
  const dir = tmpDir('tg-sec-hooks-ok-');
  const home = tmpDir('tg-sec-home-ok-');
  try {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: '.*',
              hooks: [{ type: 'command', command: 'node scripts/gate-check.js' }],
            },
          ],
        },
      }),
    );
    const r = assessHookDrift(dir, home);
    assert.equal(r.drifted, false);
    assert.equal(r.anyGateCheck, true);
    assert.equal(r.findings.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('assessPrivilegedCoverage detects secret + force-push coverage', () => {
  const gates = [
    { id: 'secret-exfiltration', action: 'block', pattern: 'secret' },
    { id: 'force-push-block', action: 'block', pattern: 'force push' },
  ];
  const r = assessPrivilegedCoverage(gates);
  assert.ok(r.covered.some((c) => c.id === 'secret-exfil'));
  assert.ok(r.covered.some((c) => c.id === 'destructive-shell'));
  assert.ok(r.missing.length >= 1);
});

test('assessPolicyVariance critical when zero block gates', () => {
  const r = assessPolicyVariance([], [{ id: 'x', action: 'warn' }]);
  assert.ok(r.findings.some((f) => f.id === 'policy-no-blocks'));
  assert.equal(r.blockCount, 0);
});

test('assessMcpThumbgate requires thumbgate server entry', () => {
  const dir = tmpDir('tg-sec-mcp-');
  try {
    fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { github: {} } }));
    const r = assessMcpThumbgate(dir);
    assert.equal(r.thumbgate, false);
    assert.ok(r.findings.some((f) => f.id === 'mcp-no-thumbgate'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('scorePosture drops for critical findings', () => {
  const healthy = scorePosture([]);
  assert.equal(healthy.score, 100);
  assert.equal(healthy.band, 'healthy');
  const bad = scorePosture([
    { severity: 'critical', id: 'a' },
    { severity: 'critical', id: 'b' },
    { severity: 'high', id: 'c' },
  ]);
  assert.ok(bad.score < 50);
  assert.ok(bad.band === 'critical' || bad.band === 'at_risk');
});

test('buildSecurityCentralReport is free, scores healthy project fixtures', () => {
  const dir = tmpDir('tg-sec-full-');
  const home = tmpDir('tg-sec-home-full-');
  try {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.thumbgate'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: '.*',
              hooks: [{ type: 'command', command: 'npx thumbgate gate-check' }],
            },
          ],
        },
      }),
    );
    fs.writeFileSync(
      path.join(dir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          thumbgate: { command: 'node', args: ['adapters/mcp/server-stdio.js'] },
        },
      }),
    );
    fs.writeFileSync(
      path.join(dir, '.thumbgate', 'gate-stats.json'),
      JSON.stringify({ totalBlocked: 3, blocked: 3 }),
    );

    const manualPath = path.join(dir, 'manual-gates.json');
    fs.writeFileSync(
      manualPath,
      JSON.stringify({
        gates: [
          { id: 'secret-exfiltration-block', action: 'block', pattern: 'secret' },
          { id: 'force-push-block', action: 'block', pattern: 'force-push' },
          { id: 'branch-protection-never-bypass', action: 'block', pattern: 'branch protection' },
          { id: 'spend-guard', action: 'block', pattern: 'spend stripe' },
          { id: 'production-deploy-gate', action: 'block', pattern: 'deploy production' },
        ],
      }),
    );

    const report = buildSecurityCentralReport({
      projectRoot: dir,
      homeDir: home,
      env: { HOME: home },
      manualGatesPath: manualPath,
      autoGatesPath: path.join(dir, 'missing-auto.json'),
    });

    assert.equal(report.free, true);
    assert.equal(report.product, 'ThumbGate Agent Security Central');
    assert.equal(report.dimensions.configurationDrift.drifted, false);
    assert.equal(report.dimensions.mcpWiring.thumbgate, true);
    assert.equal(report.dimensions.privilegedAccess.missingCount, 0);
    assert.equal(report.dimensions.sensitiveDataAudit.hasEvidence, true);
    assert.ok(report.posture.score >= 80);
    assert.match(formatSecurityCentralReport(report), /FREE local report/);
    assert.match(formatSecurityCentralReport(report), /security-central/);
    // No paid pilot language
    const text = JSON.stringify(report);
    assert.equal(/\$499|pilot sow|enterprise pilot/i.test(text), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('buildSecurityCentralReport surfaces drift + empty policy as findings', () => {
  const dir = tmpDir('tg-sec-bad-');
  const home = tmpDir('tg-sec-home-bad-');
  try {
    fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: {} }));
    const emptyGates = path.join(dir, 'empty.json');
    fs.writeFileSync(emptyGates, JSON.stringify({ gates: [] }));
    const report = buildSecurityCentralReport({
      projectRoot: dir,
      homeDir: home,
      env: { HOME: home },
      manualGatesPath: emptyGates,
      autoGatesPath: emptyGates,
    });
    assert.ok(report.findings.length >= 2);
    assert.ok(report.posture.score < 100);
    assert.ok(report.remediation.length >= 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Regression tests for the five P1 review findings on PR #3491.
// Each asserts the CONTROL behaves correctly against known-bad input, rather
// than asserting the happy path. All five failed against the pre-fix code.
// ---------------------------------------------------------------------------

test('assessPrivilegedCoverage: advisory-only gates do NOT count as coverage', () => {
  // A warn-action gate matches the secret-exfil category. The operation still
  // executes, so certifying it as coverage would report phantom enforcement.
  const warnOnly = [
    { id: 'secret-warn', action: 'warn', category: 'secret', description: 'credential exfil' },
  ];
  const r = assessPrivilegedCoverage(warnOnly);
  const gap = r.findings.find((f) => f.id === 'privileged-gap-secret-exfil');
  assert.ok(gap, 'warn-only gate must still raise a privileged-gap finding');
  assert.match(gap.message, /No block-action gate/);
  assert.match(gap.message, /secret-warn/);
  assert.ok(!r.covered.some((c) => c.id === 'secret-exfil'));

  // Same category with action=block IS coverage.
  const blocking = [
    { id: 'secret-block', action: 'block', category: 'secret', description: 'credential exfil' },
  ];
  const r2 = assessPrivilegedCoverage(blocking);
  assert.ok(!r2.findings.some((f) => f.id === 'privileged-gap-secret-exfil'));
  assert.equal(r2.covered.find((c) => c.id === 'secret-exfil').action, 'block');
});

test('assessHookDrift: a PostToolUse gate-check does NOT satisfy PreToolUse wiring', () => {
  const dir = tmpDir('tg-sec-post-');
  const home = tmpDir('tg-sec-home-post-');
  try {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [],
          PostToolUse: [{ hooks: [{ command: 'thumbgate gate-check' }] }],
        },
      }),
    );
    const r = assessHookDrift(dir, home);
    assert.equal(r.anyThumbgateHook, false, 'PostToolUse must not register as PreToolUse wiring');
    assert.equal(r.drifted, true);
    assert.ok(r.findings.some((f) => f.id === 'hook-drift-missing-thumbgate'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('assessSensitiveAudit: empty or malformed audit files are not evidence', () => {
  const dir = tmpDir('tg-sec-audit-');
  const home = tmpDir('tg-sec-home-audit-');
  try {
    fs.mkdirSync(path.join(dir, '.thumbgate'), { recursive: true });
    // Empty JSONL + malformed JSON: both exist, neither is usable evidence.
    fs.writeFileSync(path.join(dir, '.thumbgate', 'audit-trail.jsonl'), '');
    fs.writeFileSync(path.join(dir, '.thumbgate', 'gate-stats.json'), '{ not json');
    const r = assessSensitiveAudit(dir, home, {});
    assert.equal(r.hasEvidence, false, 'unusable files must not set hasEvidence');
    assert.equal(r.auditEvents, 0);
    assert.ok(
      r.findings.some((f) => f.id === 'audit-missing'),
      'audit-missing remediation must survive unusable files',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('assessSensitiveAudit: large JSONL is tail-scanned, not fully materialized', () => {
  const dir = tmpDir('tg-sec-big-');
  const home = tmpDir('tg-sec-home-big-');
  try {
    fs.mkdirSync(path.join(dir, '.thumbgate'), { recursive: true });
    const logPath = path.join(dir, '.thumbgate', 'audit-trail.jsonl');
    // ~60k records; only the tail window should be inspected.
    const line = JSON.stringify({ event: 'allow', tool: 'Bash' });
    fs.writeFileSync(logPath, `${line}\n`.repeat(60000));
    fs.appendFileSync(logPath, `${JSON.stringify({ event: 'blocked', reason: 'secret' })}\n`);

    const before = process.memoryUsage().heapUsed;
    const r = assessSensitiveAudit(dir, home, {});
    const grewMb = (process.memoryUsage().heapUsed - before) / (1024 * 1024);

    assert.equal(r.hasEvidence, true);
    assert.ok(r.secretDenialSignals >= 1, 'must still detect the trailing secret denial');
    assert.ok(grewMb < 64, `tail scan should stay bounded, heap grew ${grewMb.toFixed(1)} MB`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('buildSecurityCentralReport: project auto-gates load when HOME store is absent', () => {
  const dir = tmpDir('tg-sec-autogates-');
  const home = tmpDir('tg-sec-home-autogates-');
  try {
    fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: {} }));
    fs.mkdirSync(path.join(dir, '.thumbgate'), { recursive: true });
    // Project has a real block gate; HOME has NO auto-promoted-gates.json.
    fs.writeFileSync(
      path.join(dir, '.thumbgate', 'auto-promoted-gates.json'),
      JSON.stringify({
        gates: [
          { id: 'auto-secret-block', action: 'block', category: 'secret', description: 'credential exfil' },
        ],
      }),
    );
    const emptyManual = path.join(dir, 'manual.json');
    fs.writeFileSync(emptyManual, JSON.stringify({ gates: [] }));

    const report = buildSecurityCentralReport({
      projectRoot: dir,
      homeDir: home,
      env: {},
      manualGatesPath: emptyManual,
    });

    assert.equal(
      report.dimensions.policyVariance.autoCount,
      1,
      'project auto-promoted gate must be counted',
    );
    assert.equal(report.dimensions.policyVariance.blockCount, 1);
    assert.ok(
      !report.findings.some((f) => f.id === 'policy-no-blocks'),
      'a real project block gate must not be reported as allow-by-default',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});
