#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const {
  readJSONL,
  exportDpoFromMemories,
  DEFAULT_LOCAL_MEMORY_LOG,
} = require('./export-dpo-pairs');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;

    const trimmed = token.slice(2);
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex !== -1) {
      const key = trimmed.slice(0, separatorIndex);
      args[key] = trimmed.slice(separatorIndex + 1);
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args[trimmed] = next;
      index += 1;
      continue;
    }

    args[trimmed] = true;
  }
  if (args['input-path'] && !args.inputPath) args.inputPath = args['input-path'];
  if (args['memory-log-path'] && !args.memoryLogPath) args.memoryLogPath = args['memory-log-path'];
  if (args['output-path'] && !args.outputPath) args.outputPath = args['output-path'];
  return args;
}

function loadMemories(args) {
  if (args.inputPath) {
    const raw = fs.readFileSync(path.resolve(args.inputPath), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : parsed.memories || [];
  }

  const memoryLogPath = args.memoryLogPath
    ? path.resolve(args.memoryLogPath)
    : DEFAULT_LOCAL_MEMORY_LOG;
  return readJSONL(memoryLogPath);
}

function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const memories = loadMemories(args);
  const result = exportDpoFromMemories(memories);

  let outputPath = null;
  if (args.outputPath) {
    outputPath = path.resolve(args.outputPath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, result.jsonl, 'utf8');
  }

  const summary = {
    pairs: result.pairs.length,
    errors: result.errors.length,
    learnings: result.learnings.length,
    unpairedErrors: result.unpairedErrors.length,
    unpairedLearnings: result.unpairedLearnings.length,
    outputPath,
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  return summary;
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(error && error.message ? error.message : 'managed DPO export failed');
    process.exit(1);
  }
}

module.exports = {
  parseArgs,
  run,
};
