'use strict';

/**
 * Coverage for the Instagram additions in scripts/post-everywhere.js.
 *
 * Specifically verifies:
 *   1. parsePostFile extracts the optional **Image:** metadata line.
 *   2. The instagram dispatcher is registered and dispatches correctly.
 *   3. Dry-run Instagram posts don't invoke generate-instagram-card or
 *      postThumbGateToInstagram.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const IG_POSTER_PATH = require.resolve('../scripts/social-analytics/instagram-thumbgate-post');
const IG_CARD_PATH = require.resolve('../scripts/social-analytics/generate-instagram-card');
const POST_EVERYWHERE_PATH = require.resolve('../scripts/post-everywhere');

const igCalls = [];
const cardCalls = [];

function installMocks() {
  igCalls.length = 0;
  cardCalls.length = 0;

  require.cache[IG_POSTER_PATH] = {
    id: IG_POSTER_PATH,
    filename: IG_POSTER_PATH,
    loaded: true,
    exports: {
      postThumbGateToInstagram: async (opts) => {
        igCalls.push(opts);
        return { id: 'ig-post-mock', data: { id: 'ig-post-mock' } };
      },
      THUMBGATE_CAPTION: 'stub',
    },
  };

  require.cache[IG_CARD_PATH] = {
    id: IG_CARD_PATH,
    filename: IG_CARD_PATH,
    loaded: true,
    exports: {
      generateInstagramCard: async (outputPath) => {
        cardCalls.push(outputPath);
        return outputPath;
      },
    },
  };
}

describe('post-everywhere (Instagram dispatcher)', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-everywhere-test-'));
    installMocks();
    delete require.cache[POST_EVERYWHERE_PATH];
  });

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    delete require.cache[IG_POSTER_PATH];
    delete require.cache[IG_CARD_PATH];
    delete require.cache[POST_EVERYWHERE_PATH];
  });

  it('parsePostFile extracts the **Image:** metadata when present', () => {
    const filePath = path.join(tmpDir, 'with-image.md');
    const imagePath = path.join(tmpDir, 'card.png');
    fs.writeFileSync(filePath, [
      '# Instagram Post',
      '**Title:** Pre-action gates',
      `**Image:** ${imagePath}`,
      '**Body:**',
      'Body line one.',
    ].join('\n'));

    const { parsePostFile } = require('../scripts/post-everywhere');
    const parsed = parsePostFile(filePath);

    assert.equal(parsed.title, 'Pre-action gates');
    // Absolute path preserved.
    assert.equal(parsed.imagePath, imagePath);
    assert.match(parsed.body, /Body line one/);
  });

  it('parsePostFile resolves relative **Image:** paths against CWD', () => {
    const filePath = path.join(tmpDir, 'relative-image.md');
    fs.writeFileSync(filePath, [
      '# Instagram Post',
      '**Title:** Relative',
      '**Image:** ./card.png',
      '**Body:**',
      'x',
    ].join('\n'));

    const { parsePostFile } = require('../scripts/post-everywhere');
    const parsed = parsePostFile(filePath);
    assert.ok(path.isAbsolute(parsed.imagePath));
    assert.ok(parsed.imagePath.endsWith('card.png'));
  });

  it('parsePostFile returns imagePath null when no **Image:** line is present', () => {
    const filePath = path.join(tmpDir, 'no-image.md');
    fs.writeFileSync(filePath, [
      '# Reddit Post: r/example',
      '**Title:** no image',
      '**Body:**',
      'text',
    ].join('\n'));

    const { parsePostFile } = require('../scripts/post-everywhere');
    const parsed = parsePostFile(filePath);
    assert.equal(parsed.imagePath, null);
  });

  it('dry-run instagram does not invoke poster or card generator', async () => {
    installMocks();
    delete require.cache[POST_EVERYWHERE_PATH];
    const { postEverywhere } = require('../scripts/post-everywhere');

    const filePath = path.join(tmpDir, 'ig-dry.md');
    fs.writeFileSync(filePath, [
      '# Post',
      '**Title:** Dry run',
      '**Body:**',
      'This is a long enough dry-run Instagram post body to satisfy the ThumbGate social quality gate minimum character requirement without tripping any safety checks.',
    ].join('\n'));

    const results = await postEverywhere(filePath, {
      platforms: ['instagram'],
      dryRun: true,
    });

    assert.ok(results.instagram, 'dispatcher present for instagram');
    assert.equal(results.instagram.dryRun, true);
    assert.equal(igCalls.length, 0, 'poster not called in dry-run');
    assert.equal(cardCalls.length, 0, 'card generator not called in dry-run');
  });

  it('live instagram dispatch uses the provided imagePath verbatim', async () => {
    installMocks();
    delete require.cache[POST_EVERYWHERE_PATH];
    // Force zernio dedup log to a temp file so publishPost isn't gated on real DB
    process.env.THUMBGATE_DEDUP_LOG_PATH = path.join(tmpDir, 'dedup.json');

    const { postEverywhere } = require('../scripts/post-everywhere');

    const imagePath = path.join(tmpDir, 'explicit-card.png');
    fs.writeFileSync(imagePath, 'fakepng');

    const filePath = path.join(tmpDir, 'ig-live.md');
    fs.writeFileSync(filePath, [
      '# Instagram Post',
      '**Title:** Live test',
      `**Image:** ${imagePath}`,
      '**Body:**',
      'This is a sufficiently long live Instagram post body used in the dispatcher test to avoid quality-gate rejection.',
    ].join('\n'));

    const results = await postEverywhere(filePath, {
      platforms: ['instagram'],
      dryRun: false,
    });

    assert.equal(igCalls.length, 1, 'poster invoked exactly once');
    assert.equal(igCalls[0].imagePath, imagePath, 'imagePath passed through unchanged');
    assert.match(igCalls[0].caption, /Live test/);
    assert.match(igCalls[0].caption, /sufficiently long live/);
    // No auto-generated card when imagePath was supplied.
    assert.equal(cardCalls.length, 0);

    assert.ok(results.instagram);
    assert.equal(results.instagram.id, 'ig-post-mock');

    delete process.env.THUMBGATE_DEDUP_LOG_PATH;
  });

  it('live instagram dispatch auto-generates a card when no imagePath is supplied', async () => {
    installMocks();
    delete require.cache[POST_EVERYWHERE_PATH];
    process.env.THUMBGATE_DEDUP_LOG_PATH = path.join(tmpDir, 'dedup-auto.json');

    const { postEverywhere } = require('../scripts/post-everywhere');

    const filePath = path.join(tmpDir, 'ig-auto.md');
    fs.writeFileSync(filePath, [
      '# Instagram Post',
      '**Title:** Auto card',
      '**Body:**',
      'This is a sufficiently long autogen Instagram body used to validate the fallback card-generation path in post-everywhere.',
    ].join('\n'));

    await postEverywhere(filePath, {
      platforms: ['instagram'],
      dryRun: false,
    });

    assert.equal(cardCalls.length, 1, 'card generator invoked when imagePath absent');
    assert.equal(igCalls.length, 1);
    assert.equal(igCalls[0].imagePath, cardCalls[0]);

    delete process.env.THUMBGATE_DEDUP_LOG_PATH;
  });
});
