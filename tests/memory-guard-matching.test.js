'use strict';

// Regression suite for the memory-guard match path.
//
// The guard used to match keywords as raw substrings against a JSON-serialized envelope,
// which meant the envelope's own key names ("toolName", "command", "filePath",
// "affectedFiles") were part of the haystack on EVERY evaluation. With a two-hit block
// threshold, any guard whose keyword list contained two common words — files, command,
// tool, name, path — blocked every action regardless of what the action actually was.

const test = require('node:test');
const assert = require('node:assert');

const {
  buildMatchHaystack,
  containsWholeWord,
  isSpecificKeyword,
  hasTwoKeywordHits,
  evaluateCompiledGuards,
  evaluatePretoolFromState,
  keywords,
  normalize,
} = require('../scripts/hybrid-feedback-context.js');

// The exact envelope gates-engine and workflow-sentinel serialize.
function envelope(command, affectedFiles = []) {
  return JSON.stringify({ toolName: 'Bash', command, filePath: null, affectedFiles });
}

// ---------------------------------------------------------------------------
// buildMatchHaystack
// ---------------------------------------------------------------------------

test('haystack excludes JSON envelope key names', () => {
  const hay = normalize(buildMatchHaystack(envelope('curl 127.0.0.1:9333/json/version')));
  for (const structural of ['toolname', 'command', 'filepath', 'affectedfiles']) {
    assert.ok(!hay.includes(structural), `structural key "${structural}" must not be in the haystack`);
  }
});

test('haystack keeps every value', () => {
  const hay = buildMatchHaystack(envelope('rm -rf build', ['src/a.js', 'src/b.js']));
  assert.ok(hay.includes('rm -rf build'));
  assert.ok(hay.includes('src/a.js'));
  assert.ok(hay.includes('src/b.js'));
  assert.ok(hay.includes('Bash'));
});

test('haystack passes plain command strings through unchanged', () => {
  assert.equal(buildMatchHaystack('git push --force main'), 'git push --force main');
});

test('haystack accepts a raw object (context-manager passes one)', () => {
  const hay = buildMatchHaystack({ toolName: 'Bash', command: 'git reset --hard' });
  assert.ok(hay.includes('git reset --hard'));
  assert.ok(!hay.includes('toolName'));
});

test('haystack flattens nested structures', () => {
  const hay = buildMatchHaystack({ a: { b: ['deep-value', { c: 'deeper' }] } });
  assert.ok(hay.includes('deep-value'));
  assert.ok(hay.includes('deeper'));
  assert.ok(!hay.includes('deep-value_key'));
});

test('haystack handles malformed JSON by passing it through', () => {
  assert.equal(buildMatchHaystack('{not valid json'), '{not valid json');
});

test('haystack handles null, undefined and empty input', () => {
  assert.equal(buildMatchHaystack(null), '');
  assert.equal(buildMatchHaystack(undefined), '');
  assert.equal(buildMatchHaystack(''), '');
});

test('haystack drops booleans but keeps numbers', () => {
  const hay = buildMatchHaystack({ enabled: true, disabled: false, port: 9333 });
  assert.ok(!hay.includes('true'));
  assert.ok(!hay.includes('false'));
  assert.ok(hay.includes('9333'));
});

test('haystack survives circular references', () => {
  const node = { command: 'git status' };
  node.self = node;
  assert.doesNotThrow(() => buildMatchHaystack(node));
  assert.ok(buildMatchHaystack(node).includes('git status'));
});

test('haystack survives a JSON array envelope', () => {
  assert.ok(buildMatchHaystack('["alpha","beta"]').includes('alpha'));
});

test('haystack excludes claw metadata key names', () => {
  // evaluateClawPretool wraps the input in {_claw:{actionType,agentId,hybridRoute,…}}
  // and stringifies it; those key names must not become matchable tokens either.
  const clawEnvelope = JSON.stringify({
    raw: 'git status',
    _claw: { actionType: 'shell', agentId: 'agent-7', hybridRoute: 'local', screenInteraction: false, fileAccess: true },
  });
  const hay = normalize(buildMatchHaystack(clawEnvelope));
  for (const structural of ['_claw', 'actiontype', 'agentid', 'hybridroute', 'screeninteraction', 'fileaccess', 'raw']) {
    assert.ok(!hay.includes(structural), `claw key "${structural}" must not be in the haystack`);
  }
  assert.ok(hay.includes('git status'), 'the actual action must survive');
  assert.ok(hay.includes('agent-7'), 'metadata VALUES are still matchable');
});

// ---------------------------------------------------------------------------
// containsWholeWord
// ---------------------------------------------------------------------------

test('whole-word matching rejects incidental substrings', () => {
  assert.equal(containsWholeWord('apps/application happens', 'app'), false);
  assert.equal(containsWholeWord('affectedfiles', 'files'), false);
  assert.equal(containsWholeWord('curl /json/version', 'jobs'), false);
});

test('whole-word matching accepts separator-delimited tokens', () => {
  assert.equal(containsWholeWord('src/jobs/queue.js', 'jobs'), true);
  assert.equal(containsWholeWord('rm -rf generated-cache', 'generated-cache'), true);
  assert.equal(containsWholeWord('deploy the app now', 'app'), true);
  assert.equal(containsWholeWord('app', 'app'), true);
});

test('whole-word matching is case-insensitive and regex-safe', () => {
  assert.equal(containsWholeWord('Deploy The App', 'app'), true);
  assert.doesNotThrow(() => containsWholeWord('a+b(c)', 'a+b'));
  assert.equal(containsWholeWord('cost is a+b', 'a+b'), true);
});

// ---------------------------------------------------------------------------
// isSpecificKeyword
// ---------------------------------------------------------------------------

test('specificity: compound identifiers are specific', () => {
  assert.equal(isSpecificKeyword('generated-cache'), true, 'hyphen compound');
  assert.equal(isSpecificKeyword('tool_registry'), true, 'underscore compound');
  assert.equal(isSpecificKeyword('force-push'), true, 'hyphen compound');
});

test('specificity: ordinary words are not specific, however long', () => {
  // Long English words are common vocabulary; letting one carry a block on its own
  // would over-block. They still require a second corroborating hit.
  for (const word of ['files', 'command', 'tool', 'name', 'path', 'runtime', 'removed',
    'deployment', 'permission', 'everything']) {
    assert.equal(isSpecificKeyword(word), false, `"${word}" must stay generic`);
  }
});

test('a single long-but-ordinary word does not block on its own', () => {
  const guard = artifactFor('the deployment broke everything for the user');
  const verdict = evaluateCompiledGuards(guard, 'Bash', envelope('kubectl rollout status deployment/api'));
  assert.equal(verdict.mode, 'allow', `expected allow, got ${verdict.mode}: ${verdict.reason}`);
});

// ---------------------------------------------------------------------------
// hasTwoKeywordHits
// ---------------------------------------------------------------------------

test('a single specific keyword is sufficient evidence', () => {
  assert.equal(hasTwoKeywordHits('rm -rf generated-cache', ['generated-cache', 'removed']), true);
});

test('a single generic keyword is not sufficient evidence', () => {
  assert.equal(hasTwoKeywordHits('list the files', ['files', 'runtime']), false);
});

test('two generic keywords remain sufficient evidence', () => {
  assert.equal(hasTwoKeywordHits('remove the runtime files', ['files', 'runtime']), true);
});

test('a repeated keyword does not count twice', () => {
  assert.equal(hasTwoKeywordHits('files files files', ['files', 'files']), false);
});

test('empty keyword lists never match', () => {
  assert.equal(hasTwoKeywordHits('anything at all', []), false);
  assert.equal(hasTwoKeywordHits('', ['files', 'runtime']), false);
});

// ---------------------------------------------------------------------------
// The reported false positive, end to end
// ---------------------------------------------------------------------------

function artifactFor(text, count = 5) {
  return { guards: [{ text, words: keywords(text), count, mode: 'block', hash: 'h1' }], blockThreshold: 3 };
}

test('an unrelated guard does not block a local debug-port check', () => {
  const guard = artifactFor('user thumbs-down after agent applied to jobs without permission');
  const verdict = evaluateCompiledGuards(guard, 'Bash', envelope('curl 127.0.0.1:9333/json/version'));
  assert.equal(verdict.mode, 'allow', `expected allow, got ${verdict.mode}: ${verdict.reason}`);
});

test('a guard of generic words does not block every Bash command', () => {
  const guard = artifactFor('the command changed files under that path with the wrong tool name');
  for (const command of ['ls -la', 'curl 127.0.0.1:9333/json/version', 'node --test', 'git status']) {
    const verdict = evaluateCompiledGuards(guard, 'Bash', envelope(command));
    assert.equal(verdict.mode, 'allow', `"${command}" must not be blocked by generic words`);
  }
});

test('working-tree size does not change the verdict', () => {
  const guard = artifactFor('user thumbs-down after agent applied to jobs without permission');
  const clean = evaluateCompiledGuards(guard, 'Bash', envelope('curl 127.0.0.1:9333/json/version', []));
  const dirty = evaluateCompiledGuards(
    guard,
    'Bash',
    envelope('curl 127.0.0.1:9333/json/version', Array.from({ length: 2089 }, (_, i) => `noise${i}.txt`)),
  );
  assert.equal(clean.mode, 'allow');
  assert.equal(dirty.mode, clean.mode, 'verdict must not depend on how dirty the checkout is');
});

test('a genuinely matching destructive pattern still blocks', () => {
  const guard = artifactFor('rm -rf generated-cache removed runtime files');
  const verdict = evaluateCompiledGuards(guard, 'Bash', envelope('rm -rf generated-cache'));
  assert.equal(verdict.mode, 'block', `expected block, got ${verdict.mode}`);
});

test('two corroborating generic words still block', () => {
  const guard = artifactFor('deleting runtime files broke the build');
  const verdict = evaluateCompiledGuards(guard, 'Bash', envelope('rm runtime files'));
  assert.equal(verdict.mode, 'block');
});

test('evaluatePretoolFromState applies the same haystack rules', () => {
  const state = {
    recurringNegativePatterns: [
      { text: 'the command touched files at that path', words: keywords('the command touched files at that path'), count: 9 },
    ],
    negativeToolCountsAttributed: {},
    negativeToolCounts: {},
  };
  const verdict = evaluatePretoolFromState(state, 'Bash', envelope('curl 127.0.0.1:9333/json/version'));
  assert.notEqual(verdict.mode, 'block', 'structural key names must not drive a block');
});

test('evaluatePretoolFromState still blocks a real recurring pattern', () => {
  const text = 'git push --force overwrote main';
  const state = {
    recurringNegativePatterns: [{ text, words: keywords(text), count: 9 }],
    negativeToolCountsAttributed: {},
    negativeToolCounts: {},
  };
  const verdict = evaluatePretoolFromState(state, 'Bash', envelope('git push --force main'));
  assert.equal(verdict.mode, 'block');
});
