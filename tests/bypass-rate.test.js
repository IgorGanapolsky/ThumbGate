'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { calculateStats, formatStats, computeWeeklyBypassStats } = require('../scripts/gate-stats');
const { generateDashboard } = require('../scripts/dashboard');

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-bypass-rate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('computeWeeklyBypassStats counts --no-verify attempts, break-glass, disabled gates, and satisfy_gate overrides in 7d window', (t) => {
  const dir = makeTempDir(t);
  const now = '2026-11-12T18:00:00.000Z';
  const oneDayAgo = '2026-11-11T18:00:00.000Z';
  const twoDaysAgo = '2026-11-10T18:00:00.000Z';
  const tenDaysAgo = '2026-11-02T10:00:00.000Z';

  const manualGatesPath = path.join(dir, 'manual-gates.json');
  const autoGatesPath = path.join(dir, 'auto-gates.json');
  const statsPath = path.join(dir, 'gate-stats.json');
  const auditLogPath = path.join(dir, 'audit-trail.jsonl');

  fs.writeFileSync(manualGatesPath, JSON.stringify({
    version: 1,
    gates: [
      { id: 'force-push', action: 'block', occurrences: 5 },
      { id: 'paused-lint-gate', action: 'block', enabled: false },
    ],
  }));
  fs.writeFileSync(autoGatesPath, JSON.stringify({ gates: [], promotionLog: [] }));
  fs.writeFileSync(statsPath, JSON.stringify({ blocked: 6, distinctBlocks: 5, recurringBlocks: 1 }));

  const auditRows = [
    // 2 real blocks in 7d window
    { id: 'b1', timestamp: oneDayAgo, toolName: 'Bash', toolInput: { command: 'git push --force' }, decision: 'deny', gateId: 'force-push' },
    { id: 'b2', timestamp: oneDayAgo, toolName: 'Bash', toolInput: { command: 'rm -rf /tmp/x' }, decision: 'deny', gateId: 'destructive-rm' },
    // 1 --no-verify attempt
    // 1 --no-verify attempt (denied --no-verify counted ONCE in denominator, not twice)
    { id: 'nv1', timestamp: oneDayAgo, toolName: 'Bash', toolInput: { command: 'git commit --no-verify -m "wip"' }, decision: 'deny', gateId: 'git-no-verify' },
    // False-positive traps: git push -n (--dry-run) and chained -n / commit message -n MUST NOT count
    { id: 'fp1', timestamp: oneDayAgo, toolName: 'Bash', toolInput: { command: 'git push -n origin feat/x' }, decision: 'allow' },
    { id: 'fp2', timestamp: oneDayAgo, toolName: 'Bash', toolInput: { command: 'git commit -m "handle -n option" && git log -n 1' }, decision: 'allow' },
    // 1 break-glass invocation across 3 rows + revocation + TTL consumption -> counted once
    { id: 'bg1', timestamp: twoDaysAgo, toolName: 'gate-override', decision: 'override', gateId: 'pr_create_allowed', override: { gateId: 'pr_create_allowed', source: 'break-glass', actor: 'operator', reason: 'hotfix' } },
    { id: 'bg2', timestamp: '2026-11-10T18:00:01.200Z', toolName: 'gate-override', decision: 'override', gateId: 'pr_threads_checked', override: { gateId: 'pr_threads_checked', source: 'break-glass', actor: 'operator', reason: 'hotfix' } },
    { id: 'bg3', timestamp: '2026-11-10T18:00:02.400Z', toolName: 'gate-override', decision: 'override', gateId: 'thumbgate_break_glass', override: { gateId: 'thumbgate_break_glass', source: 'break-glass', actor: 'operator', reason: 'hotfix' } },
    { id: 'bg_use', timestamp: '2026-11-10T18:01:00.000Z', toolName: 'Edit', decision: 'allow', gateId: 'thumbgate_break_glass' },
    { id: 'bg_rev', timestamp: '2026-11-10T18:05:00.000Z', toolName: 'gate-override', decision: 'override', gateId: 'thumbgate_break_glass', override: { gateId: 'thumbgate_break_glass', source: 'break-glass', actor: 'operator', reason: 'grant revoked before expiry' } },
    // 1 disabled-gate runtime warning
    { id: 'dg1', timestamp: oneDayAgo, toolName: 'Bash', decision: 'warn', gateId: 'approval-gate', message: '[approval gate disabled] deploy check' },
    // 2 satisfy_gate / admin overrides (override + MCP gateId alias + tool-latency counted once, plus 1 admin override)
    { id: 'sg_audit', timestamp: oneDayAgo, toolName: 'gate-override', decision: 'override', gateId: 'pr_threads_checked', override: { gateId: 'pr_threads_checked', source: 'mcp', actor: 'agent', reason: 'verified 0 threads' } },
    { id: 'sg_mcp', timestamp: '2026-11-11T18:00:01.500Z', toolName: 'satisfy_gate', toolInput: { gateId: 'pr_threads_checked' }, decision: 'allow', gateId: null },
    { id: 'sg_lat', timestamp: '2026-11-11T18:00:01.600Z', toolName: 'satisfy_gate', toolInput: { gateId: 'pr_threads_checked' }, decision: 'allow', gateId: null, source: 'tool-latency' },
    { id: 'adm1', timestamp: oneDayAgo, toolName: 'Bash', decision: 'allow', gateId: 'outbound-email-send', source: 'gates-engine-admin-override' },
    // Older than 7 days -> excluded
    { id: 'old1', timestamp: tenDaysAgo, toolName: 'gate-override', decision: 'override', gateId: 'old_gate', override: { gateId: 'old_gate', source: 'cli', actor: 'agent', reason: 'stale' } },
  ];
  fs.writeFileSync(auditLogPath, auditRows.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const stats = calculateStats({ manualGatesPath, autoGatesPath, statsPath, auditLogPath, now });
  assert.equal(stats.totalGates, 1);
  assert.equal(stats.bypassStats.noVerifyAttempts, 1);
  assert.equal(stats.bypassStats.breakGlass, 1);
  assert.equal(stats.bypassStats.disabledGates, 2);
  assert.equal(stats.bypassStats.satisfyGateOverrides, 2);
  assert.equal(stats.weeklyBypasses, 6);
  // 5 runtime event bypasses + 2 non-bypass blocks (b1, b2) = 7 gated decisions -> 5/7 = 0.7143
  assert.equal(stats.bypassStats.eventBypasses, 5);
  assert.equal(stats.bypassStats.weeklyBlocks, 3);
  assert.equal(stats.weeklyBypassRate, 0.7143);

  const formatted = formatStats(stats);
  assert.match(formatted, /Actions blocked: 6\n {2}Gates bypassed \(7d\): 6 \(71\.4% of gated decisions\)/);
  assert.match(formatted, /--no-verify: 1, break-glass: 1, disabled: 2, satisfy_gate: 2/);

  // Idle week with 1 disabled config gate and 0 audit events yields bypassRate: null (never 100%)
  const idleWithDisabled = computeWeeklyBypassStats({
    auditLogPath: path.join(dir, 'missing.jsonl'),
    allGates: [{ id: 'paused', action: 'off' }],
    now,
  });
  assert.equal(idleWithDisabled.weeklyTotal, 1);
  assert.equal(idleWithDisabled.eventBypasses, 0);
  assert.equal(idleWithDisabled.bypassRate, null);

  const dash = generateDashboard(dir, { now });
  assert.equal(dash.gateStats.weeklyBypasses >= 5, true);
  assert.equal(dash.todayOverview.gateStatusChips.weeklyBypassRate, 0.7143);
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');
  assert.match(html, /data-chip-count="bypassed-week"/);
  assert.match(html, /data-chip-label="bypassed-week"/);
});
