'use strict';

const path = require('node:path');
const { initDb } = require('./store');
const { generateDigest, writeDigest } = require('./digest');
const { sendSlackDigest, formatDigestForConsole } = require('./notify');

async function main(argv = process.argv.slice(2)) {
  const days = parseInt(argv.find((a) => a.startsWith('--days='))?.split('=')[1] || '7', 10) || 7;
  const outputDir = path.resolve(__dirname, '..', '..', '.artifacts', 'social', 'digests');

  console.log(`Generating ${days}-day social analytics digest...`);

  const db = initDb();
  const digest = generateDigest(db, { days });
  db.close();

  writeDigest(digest, outputDir);
  console.log(`Digest written to ${outputDir}`);

  console.log('');
  console.log(formatDigestForConsole(digest));

  await sendSlackDigest(digest);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main };
