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

test('the public privacy page names exactly the tools that take conversation data', () => {
  // The privacy page tells the world "two tools receive conversation excerpts".
  // That sentence is only trustworthy if it cannot silently go stale. If a new tool
  // starts accepting chatHistory/transcript/etc., the generated manifest picks it up
  // and this test fails until public/privacy.html is updated to match.
  const manifest = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
  const page = fs.readFileSync(
    require('node:path').resolve(__dirname, '../public/privacy.html'), 'utf8');

  for (const tool of manifest.conversationDataTools) {
    assert.ok(page.includes(tool),
      `public/privacy.html must disclose "${tool}" — it accepts conversation excerpts. `
      + 'Regenerate the manifest and update the page in the same PR.');
  }

  // Negative half: the page must not claim a tool takes conversation data when it does not.
  // manifest.tools is an array of NAME STRINGS, not objects. Mapping .name here
  // yielded all-undefined and the loop below silently checked nothing.
  const nonConversationTools = manifest.tools
    .filter((name) => !manifest.conversationDataTools.includes(name));
  assert.ok(nonConversationTools.every((name) => typeof name === 'string' && name.length > 0),
    'tools[] must be plain name strings — if the shape changed, this guard needs updating');
  assert.ok(nonConversationTools.length > 10, 'over-disclosure guard has nothing to check');
  const disclosureBlock = page.slice(
    page.indexOf('id="conversation-data"'),
    page.indexOf('</div>', page.indexOf('id="conversation-data"')));
  assert.ok(disclosureBlock.length > 0, 'privacy page is missing the conversation-data section');
  for (const name of nonConversationTools) {
    assert.ok(!disclosureBlock.includes(`<code>${name}</code>`),
      `privacy page over-discloses: "${name}" is listed as taking conversation data but does not`);
  }

  // Vacuity guard: a page that named zero tools would pass the loop above trivially.
  assert.ok(manifest.conversationDataTools.length > 0,
    'no tool takes conversation data — if that is now true, rewrite the privacy page section '
    + 'rather than leaving a disclosure that describes tools that no longer exist');
});
