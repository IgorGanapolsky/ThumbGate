#!/usr/bin/env node
'use strict';

const readline = require('readline');
const {
  DEFAULT_PRO_API,
  getLicensePath,
  isCreatorDev,
  resolveProKey,
  saveLicense,
  startLocalProDashboard,
  validateProKey,
} = require('../../scripts/pro-local-dashboard');

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  let license = resolveProKey();

  if (license && license.source === 'creator-dev') {
    console.error('👍👎 ThumbGate Pro — Creator dev mode (enterprise)\n');
  } else if (!license || !license.key) {
    console.log('\n👍👎 ThumbGate Pro — License Activation');
    console.log('─'.repeat(45));
    console.log('Enter the license key from your purchase email.');
    console.log(`(Buy Pro: ${DEFAULT_PRO_API})\n`);
    const key = await prompt('License key: ');
    if (!key) {
      console.error('No key provided. Exiting.');
      process.exit(1);
    }

    process.stderr.write('Validating... ');
    const valid = await validateProKey(key);
    if (!valid) {
      console.error('✗ Invalid key. Check your purchase email or buy Pro at:');
      console.error(`  ${DEFAULT_PRO_API}\n`);
      process.exit(1);
    }

    saveLicense(key);
    console.error(`✓ Licensed! Key saved to ${getLicensePath()}\n`);
    license = { key };
  }

  const { url } = await startLocalProDashboard({ key: license.key });
  console.log(`👍👎 ThumbGate Pro dashboard: ${url}\n`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
