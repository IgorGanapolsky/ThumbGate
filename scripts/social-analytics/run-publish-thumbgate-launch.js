#!/usr/bin/env node
'use strict';

/**
 * CLI / CI entry for ThumbGate launch + paid-offer social publish.
 *
 * Unit-tested library (`publish-thumbgate-launch.js`) requires an injected
 * direct-platform adapter and forbids embedding aggregator names so buyer-path
 * congruence tests stay clean. This thin runner supplies the live adapter.
 */

const path = require('node:path');
const {
  parseArgs,
  publishLaunchCampaign,
} = require('./publish-thumbgate-launch');
const {
  getConnectedAccounts,
  groupAccountsByPlatform,
  publishPost,
  schedulePost,
  uploadLocalMedia,
} = require('./publishers/zernio');
const { publishInstagramThumbGate } = require('./publish-instagram-thumbgate');

function buildLivePublisher() {
  return {
    getConnectedAccounts,
    groupAccountsByPlatform,
    publishPost,
    schedulePost,
    publishInstagramThumbGate,
    uploadLocalMedia,
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const publisher = options.dryRun === true ? {} : buildLivePublisher();
  const results = await publishLaunchCampaign(options, publisher);
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);

  if (results.errors && results.errors.length > 0) {
    process.exitCode = 1;
  }
  if (
    Array.isArray(results.skipped)
    && results.skipped.some((row) => row.reason === 'not_connected')
    && (!results.published || results.published.length === 0)
    && (!results.scheduled || results.scheduled.length === 0)
    && options.dryRun !== true
  ) {
    process.exitCode = 1;
  }
  return results;
}

const isDirectRun = (() => {
  try {
    return path.resolve(process.argv[1] || '') === path.resolve(__filename);
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main().catch((error) => {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  });
}

module.exports = { main, buildLivePublisher };
