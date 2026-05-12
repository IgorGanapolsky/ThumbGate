#!/usr/bin/env node
const fs = require('fs');
const { execSync } = require('child_process');

const totalShards = parseInt(process.env.TEST_TOTAL_SHARDS || '1', 10);
const shardIndex = parseInt(process.env.TEST_SHARD_INDEX || '1', 10) - 1; // 1-based to 0-based

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const allTests = pkg.scripts.test.split(' && ');

if (totalShards <= 1) {
  for (const cmd of allTests) {
    console.log(`\n=== Running: ${cmd} ===\n`);
    execSync(cmd, { stdio: 'inherit' });
  }
  process.exit(0);
}

const shardSize = Math.ceil(allTests.length / totalShards);
const start = shardIndex * shardSize;
const end = Math.min(start + shardSize, allTests.length);
const shardTests = allTests.slice(start, end);

console.log(`\n=== Running Shard ${shardIndex + 1}/${totalShards} (${shardTests.length} tests) ===\n`);

let failed = false;
for (const cmd of shardTests) {
  console.log(`\n--- Running: ${cmd} ---\n`);
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch (err) {
    console.error(`\n!!! Failed: ${cmd} !!!\n`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
