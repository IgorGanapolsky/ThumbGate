#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SOURCE = Object.freeze({
  postUrl: 'https://x.com/dair_ai/status/2048083882327916688',
  paperUrl: 'https://arxiv.org/abs/2604.00842',
  title: 'Proactive Agent Research Environment: Simulating Active Users to Evaluate Proactive Assistants',
  arxivId: '2604.00842',
  submitted: '2026-04-01',
  postCreatedAt: '2026-04-25T16:57:03.000Z',
});

function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeOptions(raw = {}) {
  return {
    workflow: String(raw.workflow || raw.name || 'proactive agent workflow').trim() || 'proactive agent workflow',
    apps: splitList(raw.apps || raw.applications),
    states: splitList(raw.states || raw['app-states']),
    stateCount: parseNumber(raw['state-count'] || raw.stateCount || splitList(raw.states).length, splitList(raw.states).length),
    actionCount: parseNumber(raw['action-count'] || raw.actionCount, 0),
    taskCount: parseNumber(raw['task-count'] || raw.taskCount, 0),
    hasStateMachine: parseBoolean(raw['state-machine'] || raw.hasStateMachine, false),
    hasActiveUserSimulation: parseBoolean(raw['active-user-simulation'] || raw.hasActiveUserSimulation, false),
    hasGoalInferenceEvals: parseBoolean(raw['goal-inference-evals'] || raw.hasGoalInferenceEvals, false),
    hasInterventionTimingEvals: parseBoolean(raw['intervention-timing-evals'] || raw.hasInterventionTimingEvals, false),
    hasMultiAppEvals: parseBoolean(raw['multi-app-evals'] || raw.hasMultiAppEvals, false),
    flatToolApiOnly: parseBoolean(raw['flat-tool-api-only'] || raw.flatToolApiOnly, false),
    proactiveWrites: parseBoolean(raw['proactive-writes'] || raw.proactiveWrites, false),
    userVisibleActions: parseBoolean(raw['user-visible-actions'] || raw.userVisibleActions, false),
  };
}

function buildSignals(options) {
  const signals = [];
  if (!options.hasStateMachine || options.flatToolApiOnly) {
    signals.push({
      id: 'flat_tool_api_gap',
      severity: 'high',
      message: 'Flat tool APIs miss stateful navigation and state-dependent action spaces.',
      gate: 'Require finite-state app model before proactive execution.',
    });
  }
  if (!options.hasActiveUserSimulation) {
    signals.push({
      id: 'missing_active_user_simulation',
      severity: 'high',
      message: 'Proactive agents need simulated user progress before timing can be evaluated.',
      gate: 'Run active user simulation before enabling anticipatory actions.',
    });
  }
  if (!options.hasGoalInferenceEvals) {
    signals.push({
      id: 'missing_goal_inference_eval',
      severity: 'medium',
      message: 'The agent may intervene without evidence that it inferred the user goal correctly.',
      gate: 'Grade goal inference before intervention approval.',
    });
  }
  if (!options.hasInterventionTimingEvals) {
    signals.push({
      id: 'missing_intervention_timing_eval',
      severity: 'high',
      message: 'A helpful action at the wrong time becomes interruption or damage.',
      gate: 'Require too-early, on-time, and too-late timing eval cases.',
    });
  }
  if ((options.apps.length > 1 || options.hasMultiAppEvals === false) && options.proactiveWrites) {
    signals.push({
      id: 'multi_app_write_risk',
      severity: 'critical',
      message: 'Multi-app proactive writes can compound state mistakes across tools.',
      gate: 'Block multi-app proactive writes until orchestration evals and rollback evidence exist.',
    });
  }
  if (options.userVisibleActions && !options.hasInterventionTimingEvals) {
    signals.push({
      id: 'user_visible_interruption_risk',
      severity: 'high',
      message: 'User-visible interventions need timing proof before notification, scheduling, or communication actions.',
      gate: 'Require intervention timing proof before user-visible actions.',
    });
  }
  return signals;
}

function buildMetrics(options) {
  return [
    { id: 'goal_inference_accuracy', target: '>= 0.85', required: true },
    { id: 'intervention_timing_f1', target: '>= 0.80', required: true },
    { id: 'false_intervention_rate', target: '<= 0.05', required: true },
    { id: 'state_transition_validity', target: '>= 0.98', required: true },
    { id: 'multi_app_orchestration_success', target: options.apps.length > 1 ? '>= 0.85' : 'optional', required: options.apps.length > 1 },
  ];
}

function buildProactiveAgentEvalGuardrailsPlan(rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  const signals = buildSignals(options);
  const critical = signals.filter((signal) => signal.severity === 'critical').length;
  const high = signals.filter((signal) => signal.severity === 'high').length;

  return {
    name: 'thumbgate-proactive-agent-eval-guardrails',
    source: SOURCE,
    workflow: options.workflow,
    status: critical > 0 ? 'blocked' : high > 0 ? 'needs_eval' : 'ready',
    summary: {
      signalCount: signals.length,
      critical,
      high,
      apps: options.apps,
      stateCount: options.stateCount,
      actionCount: options.actionCount,
      taskCount: options.taskCount,
    },
    pareMapping: {
      appModel: options.hasStateMachine ? 'finite_state_machine_present' : 'finite_state_machine_required',
      userSimulation: options.hasActiveUserSimulation ? 'active_user_simulation_present' : 'active_user_simulation_required',
      actionSpace: 'state-dependent action spaces should be explicit per app state',
      evaluationAxes: [
        'context observation',
        'goal inference',
        'intervention timing',
        'multi-app orchestration',
      ],
    },
    signals,
    metrics: buildMetrics(options),
    gates: signals.map((signal) => ({
      id: signal.id,
      action: signal.severity === 'critical' ? 'block' : 'warn',
      message: signal.gate,
    })),
    nextActions: [
      'Model each app as states, allowed actions, and valid transitions before judging proactive behavior.',
      'Add active user simulation cases where the user keeps navigating while the agent observes.',
      'Evaluate goal inference separately from intervention timing so a correct goal at the wrong time is still caught.',
      'Block proactive writes across multiple apps until orchestration success and rollback evidence are measured.',
      'Attach the eval report to any claim that a proactive agent is production-ready.',
    ],
    marketingAngle: {
      headline: 'Proactive agents need stateful eval gates.',
      subhead: 'PARE shows why flat tool-call benchmarks miss real app behavior. ThumbGate turns those stateful eval failures into pre-action gates before a proactive assistant interrupts users or writes across apps.',
      replyDraft: 'This is the missing eval shape for proactive agents. Flat tool calls cannot tell whether the agent acted at the right state or the right time. ThumbGate can use this pattern as the enforcement layer: stateful eval failure -> pre-action gate before the next proactive write.',
    },
  };
}

function formatProactiveAgentEvalGuardrailsPlan(report) {
  const lines = [
    '',
    'ThumbGate Proactive Agent Eval Guardrails',
    '-'.repeat(43),
    `Workflow : ${report.workflow}`,
    `Status   : ${report.status}`,
    `Source   : ${report.source.paperUrl}`,
    `Signals  : ${report.summary.signalCount}`,
  ];
  if (report.signals.length > 0) {
    lines.push('', 'Signals:');
    for (const signal of report.signals) {
      lines.push(`  - [${signal.severity}] ${signal.id}: ${signal.message}`);
      lines.push(`    Gate: ${signal.gate}`);
    }
  }
  lines.push('', 'Required metrics:');
  for (const metric of report.metrics) {
    lines.push(`  - ${metric.id}: ${metric.target}${metric.required ? ' (required)' : ''}`);
  }
  lines.push('', 'Next actions:');
  for (const action of report.nextActions) lines.push(`  - ${action}`);
  lines.push('', `Reply draft: ${report.marketingAngle.replyDraft}`, '');
  return `${lines.join('\n')}\n`;
}

function writeProactiveAgentEvalPromoPack(outputDir = path.join(__dirname, '..', 'docs', 'marketing')) {
  const report = buildProactiveAgentEvalGuardrailsPlan({
    workflow: 'proactive assistant shipping checklist',
    apps: ['calendar', 'email', 'tasks'],
    'state-count': 12,
    'action-count': 24,
    'task-count': 143,
    'flat-tool-api-only': true,
    'proactive-writes': true,
    'user-visible-actions': true,
  });
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, 'dair-pare-proactive-agent-pack.json');
  const markdownPath = path.join(outputDir, 'dair-pare-proactive-agent-pack.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, formatProactiveAgentEvalGuardrailsPlan(report));
  return { report, jsonPath, markdownPath };
}

module.exports = {
  SOURCE,
  buildMetrics,
  buildProactiveAgentEvalGuardrailsPlan,
  buildSignals,
  formatProactiveAgentEvalGuardrailsPlan,
  normalizeOptions,
  writeProactiveAgentEvalPromoPack,
};

if (require.main === module) {
  const { jsonPath, markdownPath } = writeProactiveAgentEvalPromoPack();
  console.log(JSON.stringify({ jsonPath, markdownPath }, null, 2));
}
