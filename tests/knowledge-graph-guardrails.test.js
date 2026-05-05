'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('knowledge graph guide positions graph context as complementary enforcement demand', () => {
  const guide = read('docs', 'guides', 'code-knowledge-graph-guardrails.md');
  const html = read('public', 'guides', 'code-knowledge-graph-guardrails.html');

  assert.match(guide, /Code knowledge graphs are useful context/i);
  assert.match(guide, /ThumbGate is the enforcement layer/i);
  assert.match(guide, /Code graphs tell the agent what the system is\. ThumbGate decides what the agent is allowed to do next\./);
  assert.match(html, /"@type": "TechArticle"/);
  assert.match(html, /Understand Anything and code-graph MCPs/i);
  assert.match(html, /Knowledge Graph Safety/);
  assert.match(guide, /npx thumbgate code-graph-guardrails/);
  assert.match(html, /npx thumbgate code-graph-guardrails/);
  assert.doesNotMatch(guide, /replaces knowledge graphs/i);
});

test('knowledge graph safety templates ship as concrete pre-action gates', () => {
  const config = JSON.parse(read('config', 'gate-templates.json'));
  const templates = config.templates.filter((template) => template.category === 'Knowledge Graph Safety');
  const ids = templates.map((template) => template.id);

  assert.deepEqual(ids, [
    'require-diff-impact-before-central-edit',
    'checkpoint-cross-layer-refactor',
    'protect-graph-generated-artifacts',
  ]);
  assert.ok(templates.every((template) => template.problem));
  assert.ok(templates.every((template) => template.roi));
  assert.ok(templates.every((template) => template.rollout));
  assert.ok(templates.some((template) => template.pattern.includes('centrality')));
  assert.ok(templates.some((template) => template.pattern.includes('layers_touched')));
});

test('engagement pack is useful without inventing a partnership or hard-selling', () => {
  const pack = read('docs', 'marketing', 'knowledge-graph-engagement-pack.md');

  assert.match(pack, /Code knowledge graphs are context infrastructure\. ThumbGate is execution governance\./);
  assert.match(pack, /Technical Reply/);
  assert.match(pack, /central file edit -> require diff impact/);
  assert.match(pack, /utm_campaign=knowledge_graph_guardrails/);
  assert.match(pack, /Do not claim a partnership/i);
  assert.match(pack, /Do not lead with pricing/i);
  assert.doesNotMatch(pack, /guaranteed revenue|official partner|approved integration/i);
});
