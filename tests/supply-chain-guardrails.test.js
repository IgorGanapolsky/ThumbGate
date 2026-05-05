'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('developer machine supply chain guide positions ThumbGate as pre-action enforcement', () => {
  const guide = read('docs', 'guides', 'developer-machine-supply-chain-guardrails.md');
  const html = read('public', 'guides', 'developer-machine-supply-chain-guardrails.html');

  assert.match(guide, /Developer laptops and CI runners are now part of the software supply chain/i);
  assert.match(guide, /Secrets scanners find leaks\. ThumbGate blocks the agent behavior that creates or amplifies them\./);
  assert.match(guide, /npm package, PyPI package, Docker image, or one-shot CLI installer/i);
  assert.match(guide, /curl \| bash/);
  assert.match(html, /"@type": "TechArticle"/);
  assert.match(html, /Why developer machines are now the blast radius/i);
  assert.match(html, /package-manager trust/i);
  assert.doesNotMatch(guide, /^ThumbGate replaces secrets detection/im);
});

test('supply chain safety templates ship as concrete local execution gates', () => {
  const config = JSON.parse(read('config', 'gate-templates.json'));
  const templates = config.templates.filter((template) => template.category === 'Supply Chain Safety');
  const ids = templates.map((template) => template.id);

  assert.deepEqual(ids, [
    'block-package-lifecycle-secret-harvest',
    'review-untrusted-cli-before-execution',
    'checkpoint-dependency-bot-autofix',
    'require-credential-exposure-assessment',
  ]);
  assert.ok(templates.every((template) => template.problem));
  assert.ok(templates.every((template) => template.roi));
  assert.ok(templates.every((template) => template.rollout));
  assert.ok(templates.some((template) => template.pattern.includes('postinstall')));
  assert.ok(templates.some((template) => template.pattern.includes('npx')));
  assert.ok(templates.some((template) => template.pattern.includes('dependabot')));
  assert.ok(templates.some((template) => template.pattern.includes('docker\\/config')));
});

test('supply chain engagement pack is technical and avoids fake partnerships', () => {
  const pack = read('docs', 'marketing', 'supply-chain-security-engagement-pack.md');

  assert.match(pack, /Secrets scanners find leaks\. ThumbGate blocks the agent behavior that creates or amplifies them\./);
  assert.match(pack, /Technical Reply/);
  assert.match(pack, /package lifecycle scripts/);
  assert.match(pack, /utm_campaign=supply_chain_guardrails/);
  assert.match(pack, /Do not claim ThumbGate replaces GitGuardian/i);
  assert.match(pack, /Do not claim a partnership/i);
  assert.doesNotMatch(pack, /guaranteed revenue|official partner|approved integration/i);
});

test('landing page exposes developer-machine supply chain guide for AEO discovery', () => {
  const landingPage = read('public', 'index.html');

  assert.match(landingPage, /href="\/guides\/developer-machine-supply-chain-guardrails"/);
  assert.match(landingPage, /Developer Machine Supply Chain Guardrails/);
  assert.match(landingPage, /npm, PyPI, Docker, and CLI compromise paths/);
});
