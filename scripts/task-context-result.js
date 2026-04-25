#!/usr/bin/env node
'use strict';

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeList(value) {
  return Array.isArray(value) ? value.map(normalizeText).filter(Boolean) : [];
}

function buildTaskContextResultQuery(input = {}) {
  const task = normalizeText(input.task);
  const context = normalizeList(input.context);
  const result = normalizeText(input.result);
  const tools = normalizeList(input.tools);
  const files = normalizeList(input.files);
  const sequence = normalizeList(input.sequence);
  const audience = normalizeText(input.audience);
  const creditBudget = normalizeText(input.creditBudget) || 'standard';
  const missing = [];
  if (!task) missing.push('task');
  if (context.length === 0 && files.length === 0 && tools.length === 0) missing.push('context');
  if (!result) missing.push('result');
  const contextParts = [
    ...context,
    ...files.map((file) => `file:${file}`),
    ...tools.map((tool) => `tool:${tool}`),
  ];
  const sequenceText = sequence
    .map((step, index) => `${index + 1}. ${step}`)
    .join(' ');

  return {
    pattern: 'TaskContextResult',
    status: missing.length === 0 ? 'ready' : 'needs_context',
    missing,
    query: [
      `Task: ${task || '[required]'}`,
      `Context: ${contextParts.join('; ') || '[required]'}`,
      `Result: ${result || '[required]'}`,
      audience ? `Audience: ${audience}` : null,
      sequence.length > 0 ? `Sequence: ${sequenceText}` : null,
      `Credit budget: ${creditBudget}`,
    ].filter(Boolean).join('\n'),
    governance: {
      explicitTools: tools,
      explicitFiles: files,
      multiStep: sequence.length > 1,
      highCreditRisk: /web|browser|scrape|dashboard|presentation|multi[-\s]?step|full/i.test(`${task} ${result} ${sequence.join(' ')}`),
      recommendation: creditBudget === 'low'
        ? 'Use focused read-only work unless the operator approves a larger run.'
        : 'Run through ThumbGate gates before write/tool side effects.',
    },
  };
}

function reviewTaskContextResultQuery(input = {}) {
  const plan = input.pattern === 'TaskContextResult' ? input : buildTaskContextResultQuery(input);
  const issues = [];
  for (const field of plan.missing || []) issues.push({ field, issue: 'missing_tcr_component' });
  if (plan.governance.highCreditRisk && !/high|approved|enterprise/i.test(plan.query)) {
    issues.push({ field: 'creditBudget', issue: 'expensive_workflow_without_budget_ack' });
  }
  if (plan.governance.multiStep && !/Sequence:/i.test(plan.query)) {
    issues.push({ field: 'sequence', issue: 'missing_ordered_steps' });
  }
  return {
    status: issues.length === 0 ? 'pass' : 'warn',
    issues,
    recommendation: issues.length === 0
      ? 'Query is concrete enough for a workspace agent.'
      : 'Clarify task, context, result, tools/files, or credit budget before dispatch.',
  };
}

module.exports = {
  buildTaskContextResultQuery,
  reviewTaskContextResultQuery,
};
