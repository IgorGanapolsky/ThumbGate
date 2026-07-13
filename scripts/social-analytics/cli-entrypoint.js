'use strict';

const path = require('node:path');

function isDirectRun(argv = process.argv, filename = __filename) {
  return Boolean(argv[1]) && Object.is(path.resolve(argv[1]), path.resolve(filename));
}

function runAsyncCli(main, filename, argv = process.argv) {
  if (!isDirectRun(argv, filename)) return false;

  return Promise.resolve()
    .then(main)
    .catch((error) => {
      console.error(error?.message || error);
      process.exitCode = 1;
    });
}

module.exports = { isDirectRun, runAsyncCli };
