#!/usr/bin/env node
'use strict';

/**
 * Prompting Operating System
 *
 * Converts modern "AI power user" prompting guidance into ThumbGate pre-action
 * planning: choose the run mode, gather the right context, set reasoning
 * budget, route tools, and attach trust checks before an agent acts.
 */

const path = require('node:path');

const MODE_RULES = [
  {
    mode: 'deep-research',
    pattern: /\b(research|report|compare|market|latest|sources?|citations?|well-researched)\b/i,
    reasoningBudget: 'deep',
    tools: ['web-search', 'source-capture', 'citation-check'],
    contextRequirements: ['question', 'source scope', 'recency requirement'],
  },
  {
    mode: 'decision-support',
    pattern: /\b(decide|choose|buy|job|career|study|hire|pricing|strategy|important decision)\b/i,
    reasoningBudget: 'minutes',
    tools: ['tradeoff-table', 'risk-check', 'evidence-check'],
    contextRequirements: ['decision criteria', 'constraints', 'stakes', 'alternatives'],
  },
  {
    mode: 'build',
    pattern: /\b(build|implement|code|website|game|app|fix|ship)\b/i,
    reasoningBudget: 'standard',
    tools: ['repo-inspection', 'code-edit', 'tests'],
    contextRequirements: ['target files', 'acceptance criteria', 'verification command'],
  },
  {
    mode: 'data-analysis',
    pattern: /\b(analyze data|spreadsheet|csv|xlsx|chart|visuali[sz]e|dataset)\b/i,
    reasoningBudget: 'standard',
    tools: ['data-parser', 'charting', 'sanity-check'],
    contextRequirements: ['data file', 'analysis question', 'metric definitions'],
  },
  {
    mode: 'visual-generation',
    pattern: /\b(image|photo|diagram|visual|mockup|poster|thumbnail)\b/i,
    reasoningBudget: 'standard',
    tools: ['image-generation', 'visual-qa'],
    contextRequirements: ['visual goal', 'style direction', 'dimensions'],
  },
];

const DEFAULT_MODE = {
  mode: 'quick-answer',
  reasoningBudget: 'fast',
  tools: ['direct-answer'],
  contextRequirements: ['question'],
};

function planPromptingRun(input = {}) {
  const request = String(input.request || input.prompt || '').trim();
  const attachments = Array.isArray(input.attachments) ? input.attachments : [];
  const rule = MODE_RULES.find((candidate) => candidate.pattern.test(request)) || DEFAULT_MODE;
  const attachmentContext = inferAttachmentContext(attachments);
  const contextRequirements = Array.from(new Set([
    ...rule.contextRequirements,
    ...attachmentContext.requirements,
  ]));
  const providedContext = inferProvidedContext(request, attachments);
  const missingContext = contextRequirements.filter((item) => !providedContext.includes(item));
  const trustChecks = buildTrustChecks(rule.mode, input);

  return {
    mode: rule.mode,
    reasoningBudget: rule.reasoningBudget,
    tools: Array.from(new Set([...rule.tools, ...attachmentContext.tools])),
    contextRequirements,
    providedContext,
    missingContext,
    trustChecks,
    gates: buildPromptGates({ mode: rule.mode, missingContext, trustChecks, input }),
    promptTemplate: buildPromptTemplate({ mode: rule.mode, request, contextRequirements, trustChecks }),
  };
}

function evaluatePromptReadiness(plan = {}) {
  const hardBlocks = (plan.gates || []).filter((gate) => gate.severity === 'block');
  const warnings = (plan.gates || []).filter((gate) => gate.severity === 'warn');
  return {
    allowed: hardBlocks.length === 0,
    score: Math.max(0, 100 - (hardBlocks.length * 35) - (warnings.length * 10) - ((plan.missingContext || []).length * 8)),
    hardBlocks,
    warnings,
    recommendation: hardBlocks.length
      ? 'Collect missing high-stakes context before running the agent.'
      : warnings.length
        ? 'Proceed with explicit uncertainty and evidence capture.'
        : 'Prompt is ready for execution.',
  };
}

function inferAttachmentContext(attachments = []) {
  const requirements = [];
  const tools = [];
  for (const attachment of attachments) {
    const name = String(attachment.name || attachment.path || attachment.type || '').toLowerCase();
    if (/\.(png|jpg|jpeg|webp|gif)$|image/.test(name)) {
      requirements.push('image context');
      tools.push('vision');
    }
    if (/\.(csv|tsv|xlsx|xls)$|spreadsheet|dataset/.test(name)) {
      requirements.push('data file');
      tools.push('data-parser');
    }
    if (/\.(pdf|docx|md|txt)$|document/.test(name)) {
      requirements.push('document context');
      tools.push('document-parser');
    }
  }
  return { requirements, tools };
}

function inferProvidedContext(request, attachments = []) {
  const provided = new Set();
  if (request) provided.add('question');
  if (/\b(criteria|must|need|constraint|budget|deadline)\b/i.test(request)) provided.add('constraints');
  if (/\b(option|alternative|versus|vs\.?|compare)\b/i.test(request)) provided.add('alternatives');
  if (/\b(source|cite|link|latest|2026|today|yesterday)\b/i.test(request)) {
    provided.add('source scope');
    provided.add('recency requirement');
  }
  if (/\b(test|verify|acceptance|done when)\b/i.test(request)) provided.add('verification command');
  if (/\b(file|path|component|script|module)\b|[\w.-]+\/[\w./-]+\.[a-z0-9]+/i.test(request)) {
    provided.add('target files');
  }
  if (/\b(metric|kpi|revenue|conversion|score)\b/i.test(request)) provided.add('metric definitions');
  if (attachments.length > 0) {
    provided.add('document context');
    provided.add('image context');
    provided.add('data file');
  }
  return Array.from(provided);
}

function buildTrustChecks(mode, input = {}) {
  const checks = [
    'state assumptions explicitly',
    'capture evidence before completion claim',
    'mark uncertainty when source quality is weak',
  ];
  if (mode === 'deep-research') checks.push('cite primary or authoritative sources', 'compare publication dates');
  if (mode === 'decision-support') checks.push('show tradeoffs and downside risk', 'separate reversible from irreversible choices');
  if (mode === 'build') checks.push('inspect code before editing', 'run focused tests');
  if (mode === 'data-analysis') checks.push('validate row counts and missing values', 'avoid unsupported causal claims');
  if (input.highStakes) checks.push('escalate high-stakes claims for verification');
  return checks;
}

function buildPromptGates({ mode, missingContext, trustChecks, input }) {
  const gates = [];
  const highStakes = Boolean(input.highStakes || ['decision-support'].includes(mode));
  if (highStakes && missingContext.length > 0) {
    gates.push({
      id: 'missing-high-stakes-context',
      severity: 'block',
      reason: `Missing context for high-stakes ${mode}: ${missingContext.join(', ')}`,
    });
  }
  if (missingContext.length > 0) {
    gates.push({
      id: 'missing-context-warning',
      severity: 'warn',
      reason: `Missing context may reduce answer quality: ${missingContext.join(', ')}`,
    });
  }
  if (trustChecks.includes('capture evidence before completion claim')) {
    gates.push({
      id: 'evidence-before-claim',
      severity: 'warn',
      reason: 'Do not claim completion without evidence.',
    });
  }
  return gates;
}

function buildPromptTemplate({ mode, request, contextRequirements, trustChecks }) {
  return [
    `Mode: ${mode}`,
    `Task: ${request || '<task>'}`,
    `Context to provide: ${contextRequirements.join(', ')}`,
    `Trust checks: ${trustChecks.join('; ')}`,
    'Output: answer with evidence, assumptions, and next action.',
  ].join('\n');
}

function formatPromptingPlan(plan = {}) {
  return [
    '# Prompting Operating Plan',
    '',
    `Mode: ${plan.mode}`,
    `Reasoning budget: ${plan.reasoningBudget}`,
    `Tools: ${(plan.tools || []).join(', ')}`,
    `Missing context: ${(plan.missingContext || []).join(', ') || 'none'}`,
    '',
    '## Gates',
    '',
    ...(plan.gates || []).map((gate) => `- ${gate.severity}: ${gate.id} — ${gate.reason}`),
    '',
    '## Prompt Template',
    '',
    '```text',
    plan.promptTemplate || '',
    '```',
    '',
  ].join('\n');
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = { command: argv[0] || 'plan', request: '' };
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('--request=')) args.request = arg.slice('--request='.length);
    if (arg === '--high-stakes') args.highStakes = true;
  }
  return args;
}

function isCliInvocation(argv = process.argv) {
  return Boolean(argv[1] && path.resolve(argv[1]) === __filename);
}

if (isCliInvocation()) {
  const args = parseArgs();
  const plan = planPromptingRun(args);
  if (args.command === 'json') {
    console.log(JSON.stringify({ plan, readiness: evaluatePromptReadiness(plan) }, null, 2));
  } else if (args.command === 'plan') {
    console.log(formatPromptingPlan(plan));
  } else {
    console.error(`Unknown command: ${args.command}. Use: plan, json`);
    process.exit(1);
  }
}

module.exports = {
  evaluatePromptReadiness,
  formatPromptingPlan,
  planPromptingRun,
};
