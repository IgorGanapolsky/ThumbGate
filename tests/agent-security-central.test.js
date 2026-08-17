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
