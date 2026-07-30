'use strict';

// Covers main() — specifically the --check guard, which is what actually fails CI when the
// declared tool list drifts from the shipped one. It was shipped untested: nothing proved
// it returned non-zero on a stale file, so the whole anti-drift mechanism rested on an
// unverified branch.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildManifest, main } = require('../scripts/export-directory-manifest.js');

const FAKE_TOOLS = [
  { name: 'zeta_tool', inputSchema: { properties: { note: { type: 'string' } } } },
  { name: 'alpha_tool', inputSchema: { properties: { chatHistory: { type: 'array' } } } },
  {
    name: 'prose_tool',
    // The description mentions "returns" and "messages ... turns" as PROSE. A substring scan
    // matched /turns/ inside "returns" here and reported a false conversation-data tool.
    description: 'Validates a claim and returns evidence about messages and turns.',
    inputSchema: { properties: { claim: { type: 'string' } } },
  },
];

function tmpOut() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-manifest-test-')), 'manifest.json');
}

function capture() {
  const out = []; const err = [];
  return { out, err, stdout: (t) => out.push(t), stderr: (t) => err.push(t) };
}

test('buildManifest sorts tools and detects conversation data by FIELD NAME, not prose', () => {
  const m = buildManifest(FAKE_TOOLS);
  assert.deepEqual(m.tools, ['alpha_tool', 'prose_tool', 'zeta_tool'], 'tools must be sorted');
  assert.equal(m.toolCount, 3);
  assert.deepEqual(m.conversationDataTools, ['alpha_tool'],
    'prose_tool says "returns"/"turns" in its DESCRIPTION and must not be flagged');
  assert.equal(m.dataHandling.conversationExcerptsStored, true);
});

test('buildManifest states the negative honestly when no tool takes conversation data', () => {
  const m = buildManifest([{ name: 'plain', inputSchema: { properties: { a: {} } } }]);
  assert.deepEqual(m.conversationDataTools, []);
  assert.equal(m.dataHandling.conversationExcerptsStored, false);
  assert.match(m.dataHandling.statement, /No tool accepts conversation excerpts/);
});

test('buildManifest tolerates tools with no inputSchema at all', () => {
  const m = buildManifest([{ name: 'bare' }, { name: 'empty', inputSchema: {} }]);
  assert.deepEqual(m.conversationDataTools, []);
  assert.equal(m.toolCount, 2);
});

test('write mode writes the manifest and names the conversation-data tools', async () => {
  const outPath = tmpOut();
  const cap = capture();
  const code = await main([], { readTools: async () => FAKE_TOOLS, outPath, ...cap });
  assert.equal(code, 0);
  const written = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.equal(written.toolCount, 3);
  assert.ok(cap.out.join('').includes('alpha_tool'),
    'operator must be told which tools need disclosure');
});

test('--check passes when the committed file matches the live server', async () => {
  const outPath = tmpOut();
  await main([], { readTools: async () => FAKE_TOOLS, outPath, ...capture() });
  const cap = capture();
  const code = await main(['--check'], { readTools: async () => FAKE_TOOLS, outPath, ...cap });
  assert.equal(code, 0);
  assert.match(cap.out.join(''), /OK: declared list matches/);
});

test('--check FAILS when the live server has drifted from the committed list', async () => {
  const outPath = tmpOut();
  await main([], { readTools: async () => FAKE_TOOLS, outPath, ...capture() });

  // A tool is added to the server and nobody regenerates the listing — the exact 82-vs-42
  // drift the directory review caught.
  const drifted = [...FAKE_TOOLS, { name: 'new_tool', inputSchema: { properties: {} } }];
  const cap = capture();
  const code = await main(['--check'], { readTools: async () => drifted, outPath, ...cap });
  assert.equal(code, 1, '--check must fail on drift, or the gate is decorative');
  assert.match(cap.err.join(''), /STALE/);
});

test('--check FAILS when a tool starts accepting conversation data', async () => {
  const outPath = tmpOut();
  await main([], { readTools: async () => FAKE_TOOLS, outPath, ...capture() });

  const nowTakesChat = FAKE_TOOLS.map((t) => (t.name === 'zeta_tool'
    ? { ...t, inputSchema: { properties: { transcript: { type: 'array' } } } }
    : t));
  const cap = capture();
  const code = await main(['--check'], { readTools: async () => nowTakesChat, outPath, ...cap });
  assert.equal(code, 1, 'a new conversation-data tool must not slip in silently');
  assert.match(cap.err.join(''), /STALE/);
});

test('--check FAILS when the manifest is missing entirely', async () => {
  const outPath = tmpOut();
  const cap = capture();
  const code = await main(['--check'], { readTools: async () => FAKE_TOOLS, outPath, ...cap });
  assert.equal(code, 1);
  assert.match(cap.err.join(''), /missing at/);
});
