const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  DEFAULT_CATALOG_PATH,
  buildBenchmarkPlan,
  buildModelCandidatesReport,
  getModelCandidatesReportPath,
  loadCatalog,
  recommendCandidates,
  renderModelCandidatesReport,
  writeModelCandidatesReport,
} = require('../scripts/model-candidates');

test('model candidate catalog includes Kimi K2.6 and Qwen3.6 variants', () => {
  const catalog = loadCatalog(DEFAULT_CATALOG_PATH);
  const ids = new Set(catalog.candidates.map((candidate) => candidate.id));

  assert.ok(ids.has('tinker/kimi-k2.6-32k'));
  assert.ok(ids.has('tinker/kimi-k2.6-128k'));
  assert.ok(ids.has('tinker/qwen3.6-35b-a3b'));
  assert.ok(ids.has('tinker/qwen3.6-27b'));
});

test('recommendCandidates prefers Qwen 3.6 35B A3B for pretool gating', () => {
  const report = recommendCandidates({
    workload: 'pretool-gating',
    provider: 'openai-compatible',
    gateway: 'tinker',
    maxCandidates: 2,
  });

  assert.equal(report.recommended[0].id, 'tinker/qwen3.6-35b-a3b');
  assert.ok(report.recommended[0].matchedStrengths.includes('agentic-coding'));
  assert.ok(report.recommended[0].matchedStrengths.includes('tool-use'));
});

test('recommendCandidates prefers Kimi K2.6 128k for long trace review', () => {
  const report = recommendCandidates({
    workload: 'long-trace-review',
    provider: 'openai-compatible',
    gateway: 'tinker',
    maxCandidates: 2,
  });

  assert.equal(report.recommended[0].id, 'tinker/kimi-k2.6-128k');
  assert.ok(report.recommended[0].matchedStrengths.includes('long-horizon-coding'));
  assert.ok(report.recommended[0].matchedStrengths.includes('multi-agent'));
});

test('buildBenchmarkPlan anchors candidates to ThumbGate eval commands', () => {
  const catalog = loadCatalog(DEFAULT_CATALOG_PATH);
  const candidate = catalog.candidates.find((entry) => entry.id === 'tinker/qwen3.6-35b-a3b');
  const workload = { id: 'pretool-gating', ...catalog.workloads['pretool-gating'] };
  const plan = buildBenchmarkPlan(candidate, workload);

  assert.equal(plan.candidateId, 'tinker/qwen3.6-35b-a3b');
  assert.equal(plan.commands.length, 3);
  assert.ok(plan.commands.some((entry) => entry.command.includes('thumbgate bench')));
  assert.ok(plan.commands.some((entry) => entry.command.includes('gate-eval')));
  assert.ok(plan.metrics.includes('costPer1kActionsUsd'));
});

test('writeModelCandidatesReport writes a machine-readable report', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-model-candidates-'));
  try {
    const { reportPath, report } = writeModelCandidatesReport(tmpDir, {
      workload: 'cheap-fast-path',
      provider: 'openai-compatible',
      gateway: 'tinker',
    });
    assert.equal(report.recommended[0].id, 'tinker/qwen3.6-35b-a3b');
    assert.equal(reportPath, getModelCandidatesReportPath(tmpDir));
    assert.ok(fs.existsSync(reportPath));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('renderModelCandidatesReport emits readable workload summary', () => {
  const report = buildModelCandidatesReport({
    workload: 'pretool-gating',
    provider: 'openai-compatible',
    gateway: 'tinker',
    maxCandidates: 1,
  });
  const markdown = renderModelCandidatesReport(report);

  assert.match(markdown, /Managed Model Candidates/);
  assert.match(markdown, /tinker\/qwen3.6-35b-a3b/);
  assert.match(markdown, /thumbgate bench/);
});

test('model-candidates CLI prints JSON report when requested', () => {
  const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-model-candidates-cli-'));
  const feedbackDir = path.join(isolatedDir, 'feedback');
  try {
    const stdout = execFileSync(
      process.execPath,
      ['bin/cli.js', 'model-candidates', '--workload=long-trace-review', '--provider=openai-compatible', '--gateway=tinker', '--json'],
      {
        cwd: path.join(__dirname, '..'),
        env: {
          ...process.env,
          THUMBGATE_FEEDBACK_DIR: feedbackDir,
          THUMBGATE_NO_NUDGE: '1',
        },
        encoding: 'utf8',
      },
    );
    const payload = JSON.parse(stdout);

    assert.equal(payload.report.recommended[0].id, 'tinker/kimi-k2.6-128k');
    assert.ok(fs.existsSync(payload.reportPath));
  } finally {
    fs.rmSync(isolatedDir, { recursive: true, force: true });
  }
});
