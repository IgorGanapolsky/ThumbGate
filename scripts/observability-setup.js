#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  OBSERVABILITY_CONFIG_PATH,
  observabilityConfigTemplate,
  loadObservabilityEnv,
} = require('./observability-env');

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function main(argv = process.argv.slice(2)) {
  const write = argv.includes('--write');
  const print = argv.includes('--print') || !write;
  const template = observabilityConfigTemplate();

  if (print && !write) {
    process.stdout.write(`${JSON.stringify(template, null, 2)}\n`);
    process.stdout.write(
      `\n# Write to ${OBSERVABILITY_CONFIG_PATH} with --write after filling secrets.\n` +
      '# Never commit this file. Doctor/revenue tools load it automatically.\n'
    );
  }

  if (write) {
    ensureDir(OBSERVABILITY_CONFIG_PATH);
    if (fs.existsSync(OBSERVABILITY_CONFIG_PATH)) {
      process.stderr.write(`Refusing to overwrite existing ${OBSERVABILITY_CONFIG_PATH}\n`);
      process.exitCode = 2;
      return;
    }
    fs.writeFileSync(OBSERVABILITY_CONFIG_PATH, `${JSON.stringify(template, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`Wrote template ${OBSERVABILITY_CONFIG_PATH}\n`);
  }

  const status = loadObservabilityEnv({ env: { ...process.env } });
  process.stdout.write(JSON.stringify({
    configPath: OBSERVABILITY_CONFIG_PATH,
    hasStripe: status.hasStripe,
    hasPlausible: status.hasPlausible,
    hasPosthog: status.hasPosthog,
    hasOperator: status.hasOperator,
  }, null, 2) + '\n');
}

if (require('node:path').resolve(process.argv[1] || '') === require('node:path').resolve(__filename)) {
  main();
}

module.exports = { main };
