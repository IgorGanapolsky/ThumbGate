'use strict';

// The declared surface must equal the shipped surface.
//
// 2026-07-29, Anthropic MCP Directory review: our listing declared 82 tools; the live
// server exposed 42. Six declared tools no longer existed; five live tools were undeclared.
// Nothing could catch it because the declaration lived only in a submission form. This test
// makes the manifest a build artifact of the real server, so adding or removing a tool fails
// CI until the listing is regenerated in the same change.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const { liveTools, buildManifest, OUT_PATH } = require('../scripts/export-directory-manifest.js');

test('committed manifest matches the live MCP server exactly', async () => {
  const tools = await liveTools();
  const fresh = `${JSON.stringify(buildManifest(tools), null, 2)}\n`;
  const committed = fs.readFileSync(OUT_PATH, 'utf8');
  assert.equal(committed, fresh,
    'config/directory-manifest.json is stale — run `npm run manifest:export` and update the '
    + 'directory listing to match, in the same PR that changed the tool surface');
});

test('every tool taking conversation data is disclosed', async () => {
  const manifest = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
  if (manifest.conversationDataTools.length > 0) {
    assert.equal(manifest.dataHandling.conversationExcerptsStored, true,
      'tools accept conversation excerpts but the disclosure says otherwise — this is the '
      + 'exact mismatch the directory review rejected');
    assert.match(manifest.dataHandling.userControl, /delete/i,
      'disclosure must say how a user deletes stored conversation data');
  }
});

test('the manifest is generated, never hand-edited', () => {
  const manifest = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
  assert.match(manifest._generated, /export-directory-manifest/);
  assert.ok(manifest.toolCount === manifest.tools.length, 'toolCount disagrees with tools[]');
});
