'use strict';

/**
 * Coverage for the Instagram additions in scripts/post-everywhere.js.
 *
 * Uses the `deps.instagram` dep-injection hook exposed by postEverywhere so
 * these tests don't pollute the shared module cache when the coverage runner
 * executes all tests in one process.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

describe('post-everywhere (Instagram dispatcher)', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-everywhere-test-'));
  });

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  function writePostFile(filename, lines) {
    const filePath = path.join(tmpDir, filename);
    fs.writeFileSync(filePath, lines.join('\n'));
    return filePath;
  }

  function buildInstagramDeps({ onPost, onCard } = {}) {
    const calls = { postCalls: [], cardCalls: [] };
    calls.postThumbGateToInstagram = async (opts) => {
      calls.postCalls.push(opts);
      if (onPost) return onPost(opts);
      return { id: 'ig-post-mock', data: { id: 'ig-post-mock' } };
    };
    calls.generateInstagramCard = async (outputPath) => {
      calls.cardCalls.push(outputPath);
      if (onCard) return onCard(outputPath);
      return outputPath;
    };
    return calls;
  }

  it('parsePostFile extracts the **Image:** metadata when present', () => {
    const imagePath = path.join(tmpDir, 'card.png');
    const filePath = writePostFile('with-image.md', [
      '# Instagram Post',
      '**Title:** Pre-action gates',
      `**Image:** ${imagePath}`,
      '**Body:**',
      'Body line one.',
    ]);
    const { parsePostFile } = require('../scripts/post-everywhere');
    const parsed = parsePostFile(filePath);

    assert.equal(parsed.title, 'Pre-action gates');
    assert.equal(parsed.imagePath, imagePath);
    assert.match(parsed.body, /Body line one/);
  });

  it('parsePostFile resolves relative **Image:** paths to absolute paths', () => {
    const filePath = writePostFile('relative-image.md', [
      '# Instagram Post',
      '**Title:** Relative',
      '**Image:** ./card.png',
      '**Body:**',
      'x',
    ]);
    const { parsePostFile } = require('../scripts/post-everywhere');
    const parsed = parsePostFile(filePath);
    assert.ok(path.isAbsolute(parsed.imagePath));
    assert.ok(parsed.imagePath.endsWith('card.png'));
  });

  it('parsePostFile leaves imagePath null when no **Image:** line is present', () => {
    const filePath = writePostFile('no-image.md', [
      '# Reddit Post: r/example',
      '**Title:** no image',
      '**Body:**',
      'text',
    ]);
    const { parsePostFile } = require('../scripts/post-everywhere');
    const parsed = parsePostFile(filePath);
    assert.equal(parsed.imagePath, null);
  });

  it('dry-run instagram does not invoke poster or card generator', async () => {
    const deps = buildInstagramDeps();
    const filePath = writePostFile('ig-dry.md', [
      '# Post',
      '**Title:** Dry run',
      '**Body:**',
      'This is a long enough dry-run Instagram post body to satisfy the ThumbGate social quality gate minimum character requirement without tripping any safety checks.',
    ]);

    const { postEverywhere } = require('../scripts/post-everywhere');
    const results = await postEverywhere(filePath, {
      platforms: ['instagram'],
      dryRun: true,
      deps: { instagram: deps },
    });

    assert.ok(results.instagram, 'dispatcher present for instagram');
    assert.equal(results.instagram.dryRun, true);
    assert.equal(deps.postCalls.length, 0, 'poster not called in dry-run');
    assert.equal(deps.cardCalls.length, 0, 'card generator not called in dry-run');
  });

  it('live instagram dispatch uses the provided imagePath verbatim', async () => {
    const deps = buildInstagramDeps();
    process.env.THUMBGATE_DEDUP_LOG_PATH = path.join(tmpDir, 'dedup-live.json');

    const imagePath = path.join(tmpDir, 'explicit-card.png');
    fs.writeFileSync(imagePath, 'fakepng');

    const filePath = writePostFile('ig-live.md', [
      '# Instagram Post',
      '**Title:** Live test',
      `**Image:** ${imagePath}`,
      '**Body:**',
      'This is a sufficiently long live Instagram post body used in the dispatcher test to avoid quality-gate rejection.',
    ]);

    const { postEverywhere } = require('../scripts/post-everywhere');
    const results = await postEverywhere(filePath, {
      platforms: ['instagram'],
      dryRun: false,
      deps: { instagram: deps },
    });

    assert.equal(deps.postCalls.length, 1, 'poster invoked exactly once');
    assert.equal(deps.postCalls[0].imagePath, imagePath, 'imagePath passed through unchanged');
    assert.match(deps.postCalls[0].caption, /Live test/);
    assert.match(deps.postCalls[0].caption, /sufficiently long live/);
    assert.equal(deps.cardCalls.length, 0, 'no auto-generation when imagePath supplied');
    assert.ok(results.instagram);
    assert.equal(results.instagram.id, 'ig-post-mock');

    delete process.env.THUMBGATE_DEDUP_LOG_PATH;
  });

  it('live instagram dispatch auto-generates a card when no imagePath is supplied', async () => {
    const deps = buildInstagramDeps();
    process.env.THUMBGATE_DEDUP_LOG_PATH = path.join(tmpDir, 'dedup-auto.json');

    const filePath = writePostFile('ig-auto.md', [
      '# Instagram Post',
      '**Title:** Auto card',
      '**Body:**',
      'This is a sufficiently long autogen Instagram body used to validate the fallback card-generation path in post-everywhere.',
    ]);

    const { postEverywhere } = require('../scripts/post-everywhere');
    await postEverywhere(filePath, {
      platforms: ['instagram'],
      dryRun: false,
      deps: { instagram: deps },
    });

    assert.equal(deps.cardCalls.length, 1, 'card generator invoked when imagePath absent');
    assert.equal(deps.postCalls.length, 1);
    assert.equal(deps.postCalls[0].imagePath, deps.cardCalls[0]);

    delete process.env.THUMBGATE_DEDUP_LOG_PATH;
  });
});
