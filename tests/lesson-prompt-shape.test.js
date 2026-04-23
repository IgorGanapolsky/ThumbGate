'use strict';

/**
 * Lesson-prompt shape regression tests.
 *
 * Pin the XML + multishot structure of the LLM lesson-extraction prompt so
 * accidental edits (stray whitespace, dropped tags, renamed schema fields)
 * surface as failing tests instead of degraded model output. These are
 * structural assertions only — we cannot run live Claude in CI, so we
 * measure shape, not quality. Quality measurement is the job of
 * scripts/gate-eval.js when a lesson-eval suite is added.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LLM_LESSON_SYSTEM_PROMPT,
  LLM_LESSON_MULTISHOT_EXAMPLES,
  renderMultishotExamplesForPrompt,
  buildLessonUserPrompt,
} = require('../scripts/lesson-inference');

const ALLOWED_TRIGGER_TYPES = ['debugging', 'implementation', 'question', 'error-report', 'constraint'];
const ALLOWED_ACTION_TYPES = ['do', 'avoid'];
const ALLOWED_SCOPES = ['global', 'file-level', 'project-level'];

test('system prompt uses Anthropic-style XML section tags', () => {
  for (const tag of ['task', 'output_schema', 'guidelines', 'examples']) {
    const open = `<${tag}>`;
    const close = `</${tag}>`;
    assert.ok(LLM_LESSON_SYSTEM_PROMPT.includes(open), `missing <${tag}> open tag`);
    assert.ok(LLM_LESSON_SYSTEM_PROMPT.includes(close), `missing </${tag}> close tag`);
    assert.ok(
      LLM_LESSON_SYSTEM_PROMPT.indexOf(open) < LLM_LESSON_SYSTEM_PROMPT.indexOf(close),
      `<${tag}> must open before it closes`,
    );
  }
});

test('system prompt documents the strict JSON output schema with every enum', () => {
  for (const value of ALLOWED_TRIGGER_TYPES) {
    assert.ok(LLM_LESSON_SYSTEM_PROMPT.includes(value), `trigger type "${value}" must appear in the schema doc`);
  }
  for (const value of ALLOWED_ACTION_TYPES) {
    assert.ok(LLM_LESSON_SYSTEM_PROMPT.includes(value), `action type "${value}" must appear in the schema doc`);
  }
  for (const value of ALLOWED_SCOPES) {
    assert.ok(LLM_LESSON_SYSTEM_PROMPT.includes(value), `scope "${value}" must appear in the schema doc`);
  }
});

test('multishot exemplar set has 5 entries covering positive and negative signals', () => {
  assert.equal(LLM_LESSON_MULTISHOT_EXAMPLES.length, 5, 'exemplar count pinned at 5 — edit this assertion consciously');
  const signals = LLM_LESSON_MULTISHOT_EXAMPLES.map((ex) => ex.signal);
  assert.ok(signals.includes('positive'), 'need at least one positive exemplar');
  assert.ok(signals.includes('negative'), 'need at least one negative exemplar');
});

test('every multishot exemplar output is schema-valid JSON', () => {
  for (const ex of LLM_LESSON_MULTISHOT_EXAMPLES) {
    const out = ex.output;
    assert.ok(out && typeof out === 'object', `example ${ex.signal}: output must be an object`);
    assert.ok(out.trigger && typeof out.trigger.condition === 'string', 'trigger.condition must be a string');
    assert.ok(ALLOWED_TRIGGER_TYPES.includes(out.trigger.type), `trigger.type must be one of ${ALLOWED_TRIGGER_TYPES.join('|')}, got "${out.trigger.type}"`);
    assert.ok(out.action && typeof out.action.description === 'string', 'action.description must be a string');
    assert.ok(ALLOWED_ACTION_TYPES.includes(out.action.type), `action.type must be do|avoid, got "${out.action.type}"`);
    assert.ok(typeof out.confidence === 'number' && out.confidence >= 0 && out.confidence <= 1, 'confidence in [0,1]');
    assert.ok(ALLOWED_SCOPES.includes(out.scope), `scope must be one of ${ALLOWED_SCOPES.join('|')}, got "${out.scope}"`);
    assert.ok(Array.isArray(out.tags) && out.tags.every((t) => typeof t === 'string' && t.length > 0), 'tags must be non-empty strings');
  }
});

test('rendered exemplar block is parseable by a naive tag extractor', () => {
  const rendered = renderMultishotExamplesForPrompt();
  const exampleCount = (rendered.match(/<example>/g) || []).length;
  const closeCount = (rendered.match(/<\/example>/g) || []).length;
  assert.equal(exampleCount, LLM_LESSON_MULTISHOT_EXAMPLES.length, 'one <example> per exemplar');
  assert.equal(exampleCount, closeCount, 'every <example> must be closed');

  // Every <output>...</output> block must contain parseable JSON matching
  // the exemplar object, so stray escaping never silently corrupts what
  // Claude sees during inference.
  const outputMatches = rendered.matchAll(/<output>([\s\S]*?)<\/output>/g);
  const outputs = Array.from(outputMatches).map((m) => JSON.parse(m[1]));
  assert.equal(outputs.length, LLM_LESSON_MULTISHOT_EXAMPLES.length);
  outputs.forEach((parsed, i) => {
    assert.deepEqual(parsed, LLM_LESSON_MULTISHOT_EXAMPLES[i].output, `example ${i} round-trip must match`);
  });
});

test('buildLessonUserPrompt wraps the signal, optional context, and window in XML tags', () => {
  const prompt = buildLessonUserPrompt({
    signal: 'negative',
    context: 'deploy verification missing',
    windowText: '[user]: foo\n[assistant]: bar',
  });
  assert.match(prompt, /<signal>negative<\/signal>/);
  assert.match(prompt, /<user_context>deploy verification missing<\/user_context>/);
  assert.match(prompt, /<conversation_window>\n\[user\]: foo\n\[assistant\]: bar\n<\/conversation_window>/);
});

test('buildLessonUserPrompt normalizes positive/up and negative/down signals', () => {
  for (const signal of ['positive', 'up']) {
    const prompt = buildLessonUserPrompt({ signal, windowText: '[user]: x' });
    assert.match(prompt, /<signal>positive<\/signal>/, `${signal} should normalize to positive`);
  }
  for (const signal of ['negative', 'down']) {
    const prompt = buildLessonUserPrompt({ signal, windowText: '[user]: x' });
    assert.match(prompt, /<signal>negative<\/signal>/, `${signal} should normalize to negative`);
  }
});

test('buildLessonUserPrompt omits <user_context> when no context is provided', () => {
  const prompt = buildLessonUserPrompt({ signal: 'positive', windowText: '[user]: x' });
  assert.ok(!prompt.includes('<user_context>'), 'user_context tag should be absent without context');
  assert.match(prompt, /<signal>positive<\/signal>/);
  assert.match(prompt, /<conversation_window>[\s\S]*<\/conversation_window>/);
});

test('system prompt forbids prose and code fences in the output', () => {
  // These phrases are what historically broke JSON.parse in
  // inferStructuredLessonLLM — pinning them in the prompt as explicit
  // prohibitions guards against accidental edits that relax the rule.
  assert.match(LLM_LESSON_SYSTEM_PROMPT, /no code fences/i);
  assert.match(LLM_LESSON_SYSTEM_PROMPT, /no prose|no commentary/i);
});
