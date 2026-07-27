const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-tower-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
const kpi = require('../scripts/tool-kpi-tracker');
const slo = require('../scripts/slo-alert-engine');
const anomaly = require('../scripts/access-anomaly-detector');
const tower = require('../scripts/statusline-tower');
test.after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });
// Tool KPI
test('recordToolCall writes entry', () => { const e = kpi.recordToolCall({ toolName: 'recall', latencyMs: 42, success: true }); assert.ok(e.id.startsWith('kpi_')); });
test('recordToolCall defaults', () => { assert.equal(kpi.recordToolCall({}).toolName, 'unknown'); });
test('recordToolCall tracks failures', () => { kpi.recordToolCall({ toolName: 'cf', latencyMs: 200, success: false }); kpi.recordToolCall({ toolName: 'cf', latencyMs: 150, success: true }); kpi.recordToolCall({ toolName: 'cf', latencyMs: 800, success: false }); });
test('computeToolKpis per-tool metrics', () => { const r = kpi.computeToolKpis({ periodHours: 1 }); assert.ok(r.totalCalls >= 3); const cf = r.tools.find((t) => t.toolName === 'cf'); if (cf) { assert.ok(cf.successRate < 100); assert.ok(cf.p95 >= cf.p50); } });
test('computeToolKpis server rollup', () => { assert.ok(kpi.computeToolKpis({ periodHours: 1 }).servers.length >= 1); });
test('computeToolKpis reports whether traffic evidence exists', () => { assert.equal(kpi.computeToolKpis({ periodHours: 1 }).evidenceStatus, 'measured'); });
test('getAtRiskTools finds bad tools', () => { for (let i = 0; i < 5; i++) kpi.recordToolCall({ toolName: 'bad', latencyMs: 900, success: false }); kpi.recordToolCall({ toolName: 'bad', latencyMs: 100, success: true }); assert.ok(kpi.getAtRiskTools({ periodHours: 1 }).find((t) => t.toolName === 'bad')); });
test('computeToolKpis fails closed when no traffic evidence exists', () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-kpi-empty-'));
  try {
    assert.deepEqual(kpi.computeToolKpis({ feedbackDir }), {
      periodHours: 24,
      totalCalls: 0,
      evidenceStatus: 'insufficient_evidence',
      tools: [],
      servers: [],
    });
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});
test('computeToolKpis excludes stale traffic and honors explicit storage', () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-kpi-stale-'));
  try {
    const logPath = kpi.getKpiLogPath({ feedbackDir });
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, `${JSON.stringify({
      timestamp: '2020-01-01T00:00:00.000Z',
      toolName: 'stale',
      serverName: 'mcp',
      latencyMs: 25,
      success: true,
    })}\n`);
    assert.equal(kpi.computeToolKpis({ periodHours: 1, feedbackDir }).totalCalls, 0);
    assert.equal(logPath, path.join(feedbackDir, 'tool-kpi.jsonl'));
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});
test('getAtRiskTools detects latency-only risk and ignores low-volume noise', () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-kpi-risk-'));
  try {
    for (let i = 0; i < 3; i++) {
      kpi.recordToolCall({
        toolName: 'slow',
        serverName: 'mcp',
        latencyMs: 750,
        success: true,
        feedbackDir,
      });
    }
    kpi.recordToolCall({
      toolName: 'one-off-failure',
      serverName: 'mcp',
      latencyMs: 10,
      success: false,
      feedbackDir,
    });
    const atRisk = kpi.getAtRiskTools({ feedbackDir, successRateThreshold: 90, p95Threshold: 500 });
    assert.ok(atRisk.some((tool) => tool.toolName === 'slow'));
    assert.ok(!atRisk.some((tool) => tool.toolName === 'one-off-failure'));
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});
test('percentile', () => { assert.equal(kpi.percentile([10, 20, 30, 40, 50], 50), 30); assert.equal(kpi.percentile([], 50), 0); });
test('getKpiLogPath', () => { assert.ok(kpi.getKpiLogPath().endsWith('tool-kpi.jsonl')); });
// SLO
test('DEFAULT_SLOS', () => { assert.equal(slo.DEFAULT_SLOS.successRate, 90); });
test('checkSloViolations detects', () => { const r = slo.checkSloViolations({ periodHours: 1 }); assert.ok(r.violations.find((v) => v.toolName === 'bad')); });
test('checkSloViolations custom thresholds', () => { assert.ok(slo.checkSloViolations({ slos: { successRate: 99 }, periodHours: 1 }).violationCount >= slo.checkSloViolations({ slos: { successRate: 1 }, periodHours: 1 }).violationCount); });
test('runSloCheck logs', async () => { await slo.runSloCheck({ periodHours: 1 }); assert.ok(fs.existsSync(slo.getAlertLogPath())); });
test('formatSloSection empty', () => { assert.equal(slo.formatSloSection({ violationCount: 0 }), ''); });
test('formatSloSection formats', () => { assert.ok(slo.formatSloSection({ violationCount: 1, violations: [{ severity: 'warning', toolName: 'x', reasons: ['slow'], requestCount: 5 }] }).includes('WARNING')); });
test('logAlert writes', () => { slo.logAlert({ test: true }); assert.ok(fs.existsSync(slo.getAlertLogPath())); });
// Access Anomaly
test('recordAccessAttempt authorized', () => { assert.equal(anomaly.recordAccessAttempt({ authorized: true }).authorized, true); });
test('recordAccessAttempt failed', () => { assert.equal(anomaly.recordAccessAttempt({ agentId: 'bad', authorized: false, reason: 'invalid key' }).authorized, false); });
test('computeAccessStats', () => { for (let i = 0; i < 5; i++) anomaly.recordAccessAttempt({ agentId: 'bad', authorized: false }); for (let i = 0; i < 10; i++) anomaly.recordAccessAttempt({ agentId: 'good', authorized: true }); const s = anomaly.computeAccessStats({ periodHours: 1 }); assert.ok(s.authorized >= 10); assert.ok(s.failed >= 5); });
test('detectAnomalies agent abuse', () => { const r = anomaly.detectAnomalies({ baselineHours: 1, recentHours: 1 }); assert.ok(r.anomalies.find((a) => a.type === 'agent_abuse' && a.agentId === 'bad')); });
test('formatAnomalySection empty', () => { assert.equal(anomaly.formatAnomalySection({ hasAnomalies: false }), ''); });
test('formatAnomalySection formats', () => { assert.ok(anomaly.formatAnomalySection({ hasAnomalies: true, anomalies: [{ severity: 'critical', message: 'spike' }] }).includes('CRITICAL')); });
test('getAccessLogPath', () => { assert.ok(anomaly.getAccessLogPath().endsWith('access-log.jsonl')); });
// Statusline Tower
test('getStatuslineTowerData all fields', () => { const d = tower.getStatuslineTowerData({ periodHours: 1 }); assert.ok(typeof d.totalToolCalls === 'number'); assert.ok(typeof d.sloViolations === 'number'); assert.ok(typeof d.hasAnomalies === 'boolean'); });
test('getStatuslineTowerData reflects data', () => { const d = tower.getStatuslineTowerData({ periodHours: 1 }); assert.ok(d.totalToolCalls >= 5); assert.ok(d.sloViolations >= 1); assert.ok(d.accessFailed >= 5); });
