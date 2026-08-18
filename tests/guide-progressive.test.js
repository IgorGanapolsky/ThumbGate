'use strict';

// Pins the Frigate-style progressive setup guide (GUIDE.md):
// every phase present, every fenced JSON example parseable, every
// `npx thumbgate <command>` reference backed by a real bin/cli.js case,
// and the README entry point link intact.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const guidePath = path.join(repoRoot, 'GUIDE.md');
const readmePath = path.join(repoRoot, 'README.md');
const cliPath = path.join(repoRoot, 'bin', 'cli.js');

test('GUIDE.md exists and is substantial', () => {
  assert.ok(fs.existsSync(guidePath), 'GUIDE.md must exist at repo root');
  const body = fs.readFileSync(guidePath, 'utf8');
  assert.ok(body.length > 4000, 'guide should be a real document, not a stub');
});

test('GUIDE.md keeps the five-phase progressive structure', () => {
  const body = fs.readFileSync(guidePath, 'utf8');
  for (let phase = 1; phase <= 5; phase += 1) {
    assert.match(
      body,
      new RegExp(`^## Phase ${phase} `, 'm'),
      `guide must contain a "## Phase ${phase}" heading`
    );
  }
  assert.match(body, /^## Troubleshooting$/m, 'guide must keep the troubleshooting section');
  assert.match(body, /^## Quick reference$/m, 'guide must keep the quick reference section');
  const verifySteps = body.match(/\*\*Verify it:?\*\*/g) || [];
  assert.ok(
    verifySteps.length >= 5,
    `every phase needs a verify step (found ${verifySteps.length})`
  );
});

test('every fenced JSON example in GUIDE.md parses', () => {
  const body = fs.readFileSync(guidePath, 'utf8');
  const blocks = [...body.matchAll(/```json\n([\s\S]*?)```/g)];
  assert.ok(blocks.length >= 1, 'guide should include at least one JSON config example');
  for (const block of blocks) {
    assert.doesNotThrow(
      () => JSON.parse(block[1]),
      `fenced JSON block must be valid JSON:\n${block[1].slice(0, 120)}`
    );
  }
});

test('every CLI command referenced in GUIDE.md exists in bin/cli.js', () => {
  const body = fs.readFileSync(guidePath, 'utf8');
  const cliSource = fs.readFileSync(cliPath, 'utf8');
  const refs = [...body.matchAll(/npx thumbgate ([a-z][a-z-]*)/g)].map((m) => m[1]);
  assert.ok(refs.length >= 8, `guide should exercise the CLI surface (found ${refs.length} refs)`);
  const unknown = [...new Set(refs)].filter(
    (cmd) => !cliSource.includes(`case '${cmd}'`)
  );
  assert.deepStrictEqual(
    unknown,
    [],
    `guide references CLI commands missing from bin/cli.js: ${unknown.join(', ')}`
  );
});

test('README links to the progressive guide', () => {
  const readme = fs.readFileSync(readmePath, 'utf8');
  assert.ok(
    readme.includes('GUIDE.md'),
    'README.md must link to GUIDE.md so the guide is discoverable'
  );
});
