#!/usr/bin/env node
'use strict';

/**
 * publish-instagram-thumbgate.js
 * Complete workflow: generate Instagram card image and post to Instagram via Zernio.
 *
 * Usage:
 *   node publish-instagram-thumbgate.js [--image-only] [--post-only]
 *
 * Options:
 *   --image-only    Generate image only, don't post
 *   --post-only     Post an existing image without regenerating it
 */

const path = require('path');
const fs = require('node:fs');
const { generateInstagramCard } = require('./generate-instagram-card');
const { postThumbGateToInstagram, THUMBGATE_CAPTION } = require('./instagram-thumbgate-post');

const REPO_ROOT = path.resolve(__dirname, '../..');
const IMAGE_PATH = path.join(REPO_ROOT, '.thumbgate', 'instagram-card.png');

async function publishInstagramThumbGate(options = {}) {
  const {
    caption = THUMBGATE_CAPTION,
    imageOnly = false,
    postOnly = false,
    imagePath = IMAGE_PATH,
    schedule = '',
    timezone = 'America/New_York',
    utm,
  } = options;

  try {
    // Step 1: Generate image (unless --post-only)
    if (!postOnly) {
      console.log('[workflow] Step 1: Generating Instagram card...');
      const generatedPath = await generateInstagramCard(imagePath);
      console.log(`[workflow] ✅ Image ready: ${generatedPath}`);

      if (imageOnly) {
        console.log('[workflow] Image-only mode. Stopping here.');
        return { imagePath: generatedPath };
      }
    } else if (!fs.existsSync(imagePath)) {
      throw new Error(`Image file is required for --post-only mode: ${imagePath}`);
    }

    // Step 2: Post to Instagram (unless --image-only)
    if (!imageOnly) {
      console.log('[workflow] Step 2: Publishing to Instagram via Zernio...');
      const postResult = await postThumbGateToInstagram({
        caption,
        imagePath,
        schedule,
        timezone,
        utm,
      });
      if (schedule) {
        console.log(`[workflow] ✅ Post scheduled: ${postResult.id || postResult.data?.id}`);
      } else {
        console.log(`[workflow] ✅ Post published: ${postResult.id || postResult.data?.id}`);
      }

      return {
        success: true,
        imagePath: postOnly ? undefined : imagePath,
        postId: postResult.id || postResult.data?.id,
        scheduled: Boolean(schedule),
        scheduledFor: schedule || undefined,
      };
    }
  } catch (err) {
    console.error(`[workflow] ❌ Failed: ${err.message}`);
    throw err;
  }
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const imageOnly = args.includes('--image-only');
  const postOnly = args.includes('--post-only');

  if (imageOnly && postOnly) {
    console.error('❌ Cannot specify both --image-only and --post-only');
    process.exit(1);
  }

  (async () => {
    try {
      const result = await publishInstagramThumbGate({ imageOnly, postOnly });
      console.log('\n✅ Workflow complete!');
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    } catch (err) {
      console.error(`\n❌ Workflow failed: ${err.message}`);
      process.exit(1);
    }
  })();
}

module.exports = { publishInstagramThumbGate, IMAGE_PATH };
