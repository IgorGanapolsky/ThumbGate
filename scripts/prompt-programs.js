#!/usr/bin/env node
'use strict';

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeText).filter(Boolean);
}

function buildCrePromptProgram(input = {}) {
  const name = normalizeText(input.name) || 'thumbgate_prompt_program';
  const context = normalizeText(input.context);
  const role = normalizeText(input.role);
  const expectations = normalizeArray(input.expectations);
  const outputFormat = normalizeText(input.outputFormat) || 'valid Markdown';
  const lengthCap = normalizeText(input.lengthCap) || '<= 250 words';
  const tone = normalizeText(input.tone) || 'plain, practical, non-hype';
  const safetyBoundaries = normalizeArray(input.safetyBoundaries);
  const examples = Array.isArray(input.examples) ? input.examples : [];
  const missing = [];
  if (!context) missing.push('context');
  if (!role) missing.push('role');
  if (expectations.length === 0) missing.push('expectations');

  return {
    name,
    pattern: 'CRE',
    status: missing.length === 0 ? 'ready' : 'needs_context',
    missing,
    program: {
      context,
      role,
      expectations,
      outputFormat,
      lengthCap,
      tone,
      safetyBoundaries: safetyBoundaries.length > 0
        ? safetyBoundaries
        : ['Never invent data; say unknown when evidence is missing.'],
      examples: examples.map((example, index) => ({
        id: `example_${index + 1}`,
        input: normalizeText(example?.input),
        output: normalizeText(example?.output),
      })).filter((example) => example.input && example.output),
    },
    prompt: [
      `Context: ${context || '[required]'}`,
      `Role: ${role || '[required]'}`,
      `Expectations: ${expectations.length > 0 ? expectations.join('; ') : '[required]'}`,
      `Output format: ${outputFormat}.`,
      `Length cap: ${lengthCap}.`,
      `Tone: ${tone}.`,
      `Safety: ${(safetyBoundaries.length > 0 ? safetyBoundaries : ['Never invent data; say unknown when evidence is missing.']).join('; ')}`,
    ].join('\n'),
  };
}

function reviewPromptProgram(input = {}) {
  const program = input.program?.pattern === 'CRE'
    ? input.program
    : buildCrePromptProgram(input);
  const issues = [];
  for (const field of program.missing || []) {
    issues.push({ field, issue: 'missing_cre_component' });
  }
  if (!/json|markdown|table|schema|yaml/i.test(program.program.outputFormat || '')) {
    issues.push({ field: 'outputFormat', issue: 'not_paste_ready' });
  }
  if (!/[<≤=]|\bmax\b|\bwords?\b|\bbullets?\b|\bsections?\b/i.test(program.program.lengthCap || '')) {
    issues.push({ field: 'lengthCap', issue: 'missing_length_constraint' });
  }
  if ((program.program.examples || []).length === 0) {
    issues.push({ field: 'examples', issue: 'zero_shot_only' });
  }
  const blocking = issues.filter((issue) => issue.issue !== 'zero_shot_only');
  return {
    status: blocking.length === 0 ? 'pass' : 'fail',
    issueCount: issues.length,
    issues,
    recommendation: blocking.length === 0
      ? 'Prompt program is constrained enough for routine use; add examples only if outputs drift.'
      : 'Add missing CRE, paste-ready output shape, and length constraints before using this in a critical workflow.',
  };
}

module.exports = {
  buildCrePromptProgram,
  reviewPromptProgram,
};
