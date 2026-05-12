#!/usr/bin/env node
'use strict';

const HIGH_RISK_KEYWORDS = /(^|[^a-z0-9])(delete|deploy|drop|finance|invoice|payment|production|publish|refund|secret|send|stripe|write)([^a-z0-9]|$)/i;

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
  const tools = splitList(raw.tools || raw.toolNames);
  const highRiskTools = splitList(raw['high-risk-tools'] || raw.highRiskTools)
    .concat(tools.filter((tool) => HIGH_RISK_KEYWORDS.test(tool)));
  return {
    workflow: String(raw.workflow || raw.name || 'agent workflow').trim() || 'agent workflow',
    toolCount: parseNumber(raw['tool-count'] || raw.toolCount || tools.length, tools.length),
    similarToolCount: parseNumber(raw['similar-tool-count'] || raw.similarToolCount, 0),
    conditionalBranches: parseNumber(raw['conditional-branches'] || raw.conditionalBranches, 0),
    handoffCount: parseNumber(raw['handoff-count'] || raw.handoffCount, 0),
    autonomyLevel: String(raw['autonomy-level'] || raw.autonomyLevel || 'assisted').trim().toLowerCase(),
    tools,
    highRiskTools: [...new Set(highRiskTools)],
    writeTools: splitList(raw['write-tools'] || raw.writeTools),
    hasBaselineEvals: parseBoolean(raw['baseline-evals'] || raw.hasBaselineEvals, false),
    hasDocs: parseBoolean(raw.docs || raw.hasDocs, false),
    hasExamples: parseBoolean(raw.examples || raw.hasExamples, false),
    hasEdgeCases: parseBoolean(raw['edge-cases'] || raw.hasEdgeCases, false),
    hasToolApprovals: parseBoolean(raw['tool-approvals'] || raw.hasToolApprovals, false),
    hasExitCondition: parseBoolean(raw['exit-condition'] || raw.hasExitCondition, false),
    reversibleActions: parseBoolean(raw['reversible-actions'] || raw.reversibleActions, false),
  };
}

function scoreToolRisk(options) {
  let score = 0;
  const reasons = [];
  if (options.highRiskTools.length > 0) {
    score += 35;
    reasons.push(`${options.highRiskTools.length} high-risk tool(s) can affect production, money, data, secrets, or outbound actions`);
  }
  if (options.writeTools.length > 0) {
    score += 20;
    reasons.push(`${options.writeTools.length} write-capable tool(s) need approval and audit trails`);
  }
  if (!options.reversibleActions && (options.highRiskTools.length > 0 || options.writeTools.length > 0)) {
    score += 20;
    reasons.push('some actions are not marked reversible');
  }
  if (!options.hasToolApprovals && (options.highRiskTools.length > 0 || options.writeTools.length > 0)) {
    score += 25;
    reasons.push('tool approvals are missing for risky tools');
  }

  const risk = score >= 70 ? 'high' : score >= 35 ? 'medium' : 'low';
  return { risk, score: Math.min(100, score), reasons };
}

function scoreInstructions(options) {
  const checks = [
    { id: 'docs', passed: options.hasDocs, label: 'draws on existing workflow documentation' },
    { id: 'examples', passed: options.hasExamples, label: 'includes concrete successful examples' },
    { id: 'edge_cases', passed: options.hasEdgeCases, label: 'covers edge cases and failure paths' },
    { id: 'exit_condition', passed: options.hasExitCondition, label: 'defines when the run is complete' },
  ];
  const passed = checks.filter((check) => check.passed).length;
  return {
    score: Math.round((passed / checks.length) * 100),
    checks,
    missing: checks.filter((check) => !check.passed).map((check) => check.label),
  };
}

function selectArchitecture(options, toolRisk, instructionQuality) {
  const triggers = [];
  if (options.conditionalBranches >= 8) triggers.push('instruction_complexity');
  if (options.similarToolCount >= 4 || (options.toolCount >= 10 && options.similarToolCount >= 2)) triggers.push('tool_overload');
  if (options.handoffCount > 0) triggers.push('existing_handoffs');

  if (triggers.includes('tool_overload') || triggers.includes('instruction_complexity')) {
    return {
      architecture: 'manager',
      reason: 'split specialized responsibilities behind a manager agent because instructions or similar tools are becoming hard to route reliably',
      triggers,
    };
  }

  if (options.handoffCount >= 2 && toolRisk.risk !== 'high') {
    return {
      architecture: 'decentralized',
      reason: 'peer handoffs can work because the workflow already has explicit handoff points and no high-risk tool profile',
      triggers,
    };
  }

  return {
    architecture: 'single_agent',
    reason: instructionQuality.score < 75
      ? 'improve instructions and evals before adding orchestration complexity'
      : 'a single agent with clearer tools and instructions should stay cheaper to evaluate and maintain',
    triggers,
  };
}

function buildBlockers(options, toolRisk, architecture) {
  const blockers = [];
  if (!options.hasBaselineEvals) {
    blockers.push({
      id: 'baseline_evals_required',
      severity: 'high',
      message: 'Establish baseline evals before adding tools, splitting agents, or increasing autonomy.',
    });
  }
  if (toolRisk.risk === 'high' && !options.hasToolApprovals) {
    blockers.push({
      id: 'tool_approval_required',
      severity: 'critical',
      message: 'High-risk tools need approval gates before autonomous use.',
    });
  }
  if (architecture.architecture !== 'single_agent' && architecture.triggers.length === 0) {
    blockers.push({
      id: 'multi_agent_without_trigger',
      severity: 'medium',
      message: 'Do not split agents without instruction-complexity, tool-overload, or explicit handoff evidence.',
    });
  }
  return blockers;
}

function buildAgentDesignGovernancePlan(rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  const toolRisk = scoreToolRisk(options);
  const instructionQuality = scoreInstructions(options);
  const architecture = selectArchitecture(options, toolRisk, instructionQuality);
  const blockers = buildBlockers(options, toolRisk, architecture);

  return {
    name: 'thumbgate-agent-design-governance',
    workflow: options.workflow,
    sourcePattern: 'OpenAI practical agent guide: model + tools + instructions, single-agent first, eval-driven multi-agent splits',
    status: blockers.some((blocker) => blocker.severity === 'critical') ? 'blocked' : blockers.length ? 'needs_work' : 'ready',
    recommendation: architecture,
    toolRisk,
    instructionQuality,
    evals: {
      baselinePresent: options.hasBaselineEvals,
      requiredBefore: ['new high-risk tools', 'multi-agent split', 'higher autonomy', 'auto-PR or deploy'],
    },
    blockers,
    nextActions: [
      'Keep the workflow single-agent unless evals show instruction complexity or tool overload.',
      'Write tool descriptions with clear names, parameters, side effects, and approval requirements.',
      'Add examples and edge cases to instructions before adding subagents.',
      'Add baseline evals that grade tool choice, exit condition, recovery behavior, and unsafe action refusal.',
      'Assign low, medium, or high risk to every tool based on write access, reversibility, permissions, and financial or production impact.',
    ],
  };
}

function formatAgentDesignGovernancePlan(report) {
  const lines = [
    '',
    'ThumbGate Agent Design Governance',
    '-'.repeat(35),
    `Workflow : ${report.workflow}`,
    `Status   : ${report.status}`,
    `Pattern  : ${report.recommendation.architecture}`,
    `Reason   : ${report.recommendation.reason}`,
    `Tool risk: ${report.toolRisk.risk} (${report.toolRisk.score}/100)`,
    `Instruction score: ${report.instructionQuality.score}/100`,
    `Baseline evals: ${report.evals.baselinePresent ? 'present' : 'missing'}`,
  ];

  if (report.blockers.length > 0) {
    lines.push('', 'Blockers:');
    for (const blocker of report.blockers) {
      lines.push(`  - [${blocker.severity}] ${blocker.id}: ${blocker.message}`);
    }
  }

  if (report.toolRisk.reasons.length > 0) {
    lines.push('', 'Tool risk signals:');
    for (const reason of report.toolRisk.reasons) lines.push(`  - ${reason}`);
  }

  lines.push('', 'Next actions:');
  for (const action of report.nextActions) lines.push(`  - ${action}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

module.exports = {
  buildAgentDesignGovernancePlan,
  formatAgentDesignGovernancePlan,
  normalizeOptions,
  scoreInstructions,
  scoreToolRisk,
  selectArchitecture,
};
