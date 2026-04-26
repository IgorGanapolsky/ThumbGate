'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ensureDir } = require('./fs-utils');

function normalizeText(value) {
  return String(value ?? '').trim();
}

function csvCell(value) {
  const text = normalizeText(value);
  if (!/[",\n]/.test(text)) {
    return text;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

function readGitHubAbout(repoRoot = path.resolve(__dirname, '..')) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, 'config', 'github-about.json'), 'utf8'));
}

function parseReportArgs(argv = []) {
  const options = {
    reportDir: '',
    writeDocs: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--write-docs') {
      options.writeDocs = true;
      continue;
    }
    if (arg === '--report-dir') {
      options.reportDir = normalizeText(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--report-dir=')) {
      options.reportDir = normalizeText(arg.split(/=(.*)/s)[1]);
    }
  }

  return options;
}

function writeRevenuePackArtifacts({
  repoRoot = path.resolve(__dirname, '..'),
  reportDir = '',
  writeDocs = false,
  docsPath,
  markdown,
  jsonName,
  jsonValue,
  csvName,
  csvValue,
} = {}) {
  const resolvedReportDir = normalizeText(reportDir)
    ? path.resolve(repoRoot, reportDir)
    : '';

  if (resolvedReportDir) {
    ensureDir(resolvedReportDir);
    fs.writeFileSync(path.join(resolvedReportDir, path.basename(docsPath)), markdown, 'utf8');
    if (jsonName) {
      fs.writeFileSync(path.join(resolvedReportDir, jsonName), `${JSON.stringify(jsonValue, null, 2)}\n`, 'utf8');
    }
    if (csvName) {
      fs.writeFileSync(path.join(resolvedReportDir, csvName), csvValue, 'utf8');
    }
  }

  if (writeDocs) {
    fs.writeFileSync(docsPath, markdown, 'utf8');
  }

  return {
    docsPath: writeDocs ? docsPath : null,
    markdown,
    reportDir: resolvedReportDir || null,
  };
}

function isCliInvocation(argv = process.argv, filename) {
  return Boolean(argv[1] && filename && path.resolve(argv[1]) === path.resolve(filename));
}

module.exports = {
  csvCell,
  isCliInvocation,
  normalizeText,
  parseReportArgs,
  readGitHubAbout,
  writeRevenuePackArtifacts,
};
