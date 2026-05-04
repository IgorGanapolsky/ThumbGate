const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildProactiveAgentEvalGuardrailsPlan,
  writeProactiveAgentEvalPromoPack,
} = require('../scripts/proactive-agent-eval-guardrails');

test('PARE-style proactive agent plan blocks multi-app writes without stateful evals', () => {
  const report = buildProactiveAgentEvalGuardrailsPlan({
    workflow: 'calendar email assistant',
    apps: ['calendar', 'email'],
    flatToolApiOnly: true,
    proactiveWrites: true,
    userVisibleActions: true,
  });

  assert.equal(report.name, 'thumbgate-proactive-agent-eval-guardrails');
  assert.equal(report.status, 'blocked');
  assert.ok(report.signals.some((signal) => signal.id === 'flat_tool_api_gap'));
  assert.ok(report.signals.some((signal) => signal.id === 'multi_app_write_risk'));
  assert.ok(report.metrics.some((metric) => metric.id === 'intervention_timing_f1'));
});

test('proactive agent promo pack writes markdown and json artifacts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-pare-pack-'));
  const { jsonPath, markdownPath, report } = writeProactiveAgentEvalPromoPack(dir);

  assert.equal(report.name, 'thumbgate-proactive-agent-eval-guardrails');
  assert.equal(fs.existsSync(jsonPath), true);
  assert.equal(fs.existsSync(markdownPath), true);
  assert.match(fs.readFileSync(markdownPath, 'utf8'), /Proactive Agent Eval Guardrails/);
});
