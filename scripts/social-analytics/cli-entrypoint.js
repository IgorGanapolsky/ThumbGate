'use strict';

const path = require('node:path');

function isDirectRun(argv = process.argv, filename = __filename) {
  return Boolean(argv[1]) && Object.is(path.resolve(argv[1]), path.resolve(filename));
}

async function runAsyncCli(main, filename, argv = process.argv) {
  if (!isDirectRun(argv, filename)) return false;

  try {
    await main();
    return true;
  } catch (error) {
    console.error(error?.message || error);
    process.exitCode = 1;
    return false;
  }
}

module.exports = { isDirectRun, runAsyncCli };
