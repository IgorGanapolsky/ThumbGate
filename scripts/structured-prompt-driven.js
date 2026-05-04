#!/usr/bin/env node
'use strict';

/**
 * Structured Prompt-Driven Development (SPDD) Gate
 *
 * Makes code-generation prompts governable artifacts by requiring a compact
 * REASONS canvas before risky implementation work proceeds.
 */

const path = require('node:path');

const FIELD_DEFINITIONS = [
  ['requirements', 'Problem, business value, scope, and definition of done.'],
  ['entities', 'Domain nouns, relationships, and data contracts.'],
  ['approach', 'Strategy for satisfying the requirements.'],
  ['structure', 'Files, modules, dependencies, and integration boundaries.'],
  ['operations', 'Concrete, testable implementation steps.'],
  ['norms', 'Reusable engineering standards and team conventions.'],
  ['safeguards', 'Non-negotiable constraints, risks, and verification gates.'],
];

const FIELD_KEYS = FIELD_DEFINITIONS.map(([key]) => key);

function buildReasonsCanvas(input = {}) {
  const source = typeof input === 'string' ? { request: input } : input;
  const request = String(source.request || source.story || source.task || '').trim();
  const canvas = {};

  for (const key of FIELD_KEYS) {
    canvas[key] = normalizeList(source[key]);
  }

  if (request && canvas.requirements.length === 0) {
    canvas.requirements.push(request);
  }
  if (source.acceptanceCriteria) {
    canvas.requirements.push(...normalizeList(source.acceptanceCriteria));
  }
  if (source.files || source.changedFiles) {
    canvas.structure.push(...normalizeList(source.files || source.changedFiles));
  }
  if (source.tests || source.verification) {
    canvas.safeguards.push(...normalizeList(source.tests || source.verification).map((item) => `Verification: ${item}`));
  }
  if (canvas.norms.length === 0) {
    canvas.norms.push('Keep prompt, code, and tests synchronized in version control.');
  }
  if (canvas.safeguards.length === 0) {
    canvas.safeguards.push('Do not claim completion without passing verification evidence.');
  }

  return {
    title: source.title || inferTitle(request),
    canvas,
    source: {
      request,
      artifactPath: source.artifactPath || 'docs/prompts/<feature>.reasons.md',
    },
  };
}

function evaluateReasonsCanvas(document = {}, options = {}) {
  const canvas = document.canvas || document;
  const gates = [];
  const missing = FIELD_KEYS.filter((key) => normalizeList(canvas[key]).length === 0);

  for (const key of missing) {
    gates.push({
      id: `missing-${key}`,
      severity: key === 'requirements' || key === 'safeguards' ? 'block' : 'warn',
      reason: `${labelFor(key)} is empty; the agent lacks a governed ${key} boundary.`,
    });
  }

  const operations = normalizeList(canvas.operations);
  if (operations.length > 0 && !operations.some(isTestableOperation)) {
    gates.push({
      id: 'operations-not-testable',
      severity: 'block',
      reason: 'At least one operation must be concrete and testable before code generation.',
    });
  }

  const safeguards = normalizeList(canvas.safeguards).join('\n');
  if (!/\b(tests?|verify|verification|evidence|gate|security|privacy|rollback|performance)\b/i.test(safeguards)) {
    gates.push({
      id: 'safeguards-without-verification',
      severity: 'block',
      reason: 'Safeguards must name verification, evidence, or non-negotiable risk controls.',
    });
  }

  const changedFiles = normalizeList(options.changedFiles);
  const structure = normalizeList(canvas.structure).join('\n');
  if (changedFiles.length > 0 && !changedFiles.some((file) => structure.includes(file) || structure.includes(path.basename(file)))) {
    gates.push({
      id: 'code-prompt-drift',
      severity: 'warn',
      reason: 'Changed files are not represented in the prompt structure; sync the canvas before review.',
    });
  }

  const hardBlocks = gates.filter((gate) => gate.severity === 'block');
  const warnings = gates.filter((gate) => gate.severity === 'warn');
  return {
    allowed: hardBlocks.length === 0,
    score: Math.max(0, 100 - (hardBlocks.length * 30) - (warnings.length * 10)),
    gates,
    missing,
    recommendation: hardBlocks.length
      ? 'Fix the structured prompt before generating or merging code.'
      : warnings.length
        ? 'Proceed only after syncing prompt drift and documenting review evidence.'
        : 'Structured prompt is ready for code generation and review.',
  };
}

function buildPromptSyncPlan(document = {}, changes = {}) {
  const evaluation = evaluateReasonsCanvas(document, changes);
  const changedFiles = normalizeList(changes.changedFiles);
  const verification = normalizeList(changes.verification || changes.tests);
  return {
    promptFirst: evaluation.allowed,
    artifactPath: document.source?.artifactPath || changes.artifactPath || 'docs/prompts/<feature>.reasons.md',
    requiredUpdates: [
      ...(evaluation.gates || []).map((gate) => gate.id),
      ...(changedFiles.length ? ['sync-structure-with-changed-files'] : []),
      ...(verification.length ? ['attach-verification-evidence'] : ['add-verification-evidence']),
    ],
    reviewChecklist: [
      'Review intent and scope before reviewing code diff.',
      'Confirm operations map to focused tests.',
      'Update the canvas when implementation reality diverges.',
      'Store prompt artifact beside the feature or PR evidence.',
    ],
  };
}

function formatReasonsCanvas(document = {}, evaluation = evaluateReasonsCanvas(document)) {
  const canvas = document.canvas || document;
  return [
    `# ${document.title || 'Structured Prompt Canvas'}`,
    '',
    `Artifact: ${document.source?.artifactPath || 'docs/prompts/<feature>.reasons.md'}`,
    `Readiness: ${evaluation.allowed ? 'ready' : 'blocked'} (${evaluation.score}/100)`,
    '',
    ...FIELD_DEFINITIONS.flatMap(([key, description]) => [
      `## ${labelFor(key)}`,
      '',
      `_${description}_`,
      '',
      ...renderList(normalizeList(canvas[key])),
      '',
    ]),
    '## Gates',
    '',
    ...(evaluation.gates.length ? evaluation.gates.map((gate) => `- ${gate.severity}: ${gate.id} — ${gate.reason}`) : ['- pass: canvas-ready — Structured prompt is complete enough to govern generation.']),
    '',
    `Recommendation: ${evaluation.recommendation}`,
    '',
  ].join('\n');
}

function normalizeList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value)
    .split(/\n|;/)
    .map((item) => item.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
}

function renderList(items) {
  return items.length ? items.map((item) => `- ${item}`) : ['- <missing>'];
}

function labelFor(key) {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function isTestableOperation(operation) {
  return /\b(add|update|remove|implement|verify|test|run|assert|block|allow|return|emit)\b/i.test(operation);
}

function inferTitle(request) {
  if (!request) return 'Structured Prompt Canvas';
  return request.length > 70 ? `${request.slice(0, 67)}...` : request;
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = { command: argv[0] || 'canvas', request: '' };
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('--request=')) args.request = arg.slice('--request='.length);
    if (arg.startsWith('--file=')) args.files = [...(args.files || []), arg.slice('--file='.length)];
    if (arg.startsWith('--test=')) args.tests = [...(args.tests || []), arg.slice('--test='.length)];
    if (arg.startsWith('--operation=')) args.operations = [...(args.operations || []), arg.slice('--operation='.length)];
    if (arg.startsWith('--safeguard=')) args.safeguards = [...(args.safeguards || []), arg.slice('--safeguard='.length)];
  }
  return args;
}

function isCliInvocation(argv = process.argv) {
  return Boolean(argv[1] && path.resolve(argv[1]) === __filename);
}

if (isCliInvocation()) {
  const args = parseArgs();
  const document = buildReasonsCanvas(args);
  const evaluation = evaluateReasonsCanvas(document, { changedFiles: args.files });
  if (args.command === 'json') {
    console.log(JSON.stringify({ document, evaluation, syncPlan: buildPromptSyncPlan(document, { changedFiles: args.files, tests: args.tests }) }, null, 2));
  } else if (args.command === 'canvas') {
    console.log(formatReasonsCanvas(document, evaluation));
  } else {
    console.error(`Unknown command: ${args.command}. Use: canvas, json`);
    process.exit(1);
  }
}

module.exports = {
  buildPromptSyncPlan,
  buildReasonsCanvas,
  evaluateReasonsCanvas,
  formatReasonsCanvas,
};
