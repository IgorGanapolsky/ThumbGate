#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  getConnectedAccounts,
  publishPost,
  uploadLocalMedia,
} = require('./publishers/zernio');

const DEFAULT_IMAGE = path.resolve(__dirname, '../../.thumbgate/applyops-instagram-card.png');
const DEFAULT_CAPTION = `Resume firms and staffing teams:

I have 2 ApplyOps paid-pilot slots open.

I audit 10 technical-candidate resumes for unsupported claims, ATS/title-fit risk, and writer-throughput blockers, then deliver an anonymized findings memo and 30-minute readout.

$500 deposit credited toward the $1,500 pilot:
https://igorganapolsky.github.io/applyops/partners.html?utm_source=instagram&utm_medium=social&utm_campaign=applyops_partner_pilot_20260527`;

function getArg(name) {
  const prefix = `${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
}

async function main() {
  const imagePath = path.resolve(getArg('--image-path') || DEFAULT_IMAGE);
  const captionPath = getArg('--caption-file');
  const dryRun = process.argv.includes('--dry-run');
  const caption = captionPath
    ? fs.readFileSync(path.resolve(captionPath), 'utf8').trim()
    : DEFAULT_CAPTION;

  if (!fs.existsSync(imagePath)) {
    throw new Error(`image not found: ${imagePath}`);
  }

  console.log(`[applyops:instagram] caption_chars=${caption.length}`);
  console.log(`[applyops:instagram] image=${imagePath}`);

  const accounts = await getConnectedAccounts();
  const instagram = accounts.find((account) => account.platform === 'instagram');
  if (!instagram) {
    throw new Error('No Instagram account found in Zernio connected accounts.');
  }
  console.log(`[applyops:instagram] instagram_account=${instagram.accountId}`);

  if (dryRun) {
    console.log('[applyops:instagram] dry-run: publish skipped');
    return;
  }

  const mediaItem = await uploadLocalMedia(imagePath);
  const result = await publishPost(caption, [
    { platform: 'instagram', accountId: instagram.accountId },
  ], {
    mediaItems: [mediaItem],
    utm: {
      source: 'instagram',
      medium: 'social',
      campaign: 'applyops_partner_pilot_20260527',
    },
  });

  console.log(`[applyops:instagram] published id=${result.id || result.data?.id || 'unknown'}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[applyops:instagram] failed: ${err.message}`);
    process.exit(1);
  });
}
