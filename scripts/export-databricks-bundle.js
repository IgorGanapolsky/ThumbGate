#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { getFeedbackPaths } = require('./feedback-loop');
const { ensureDir } = require('./fs-utils');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_PROOF_DIR = process.env.THUMBGATE_PROOF_DIR
  || path.join(PROJECT_ROOT, 'proof');

function parseArgs(argv) {
  const args = {};
  argv.forEach((arg) => {
    if (!arg.startsWith('--')) return;
    const [key, ...rest] = arg.slice(2).split('=');
    args[key] = rest.length ? rest.join('=') : true;
  });
  return args;
}


function readJSONL(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJSONL(filePath, rows) {
  const content = rows.map((row) => JSON.stringify(row)).join('\n');
  fs.writeFileSync(filePath, content ? `${content}\n` : '');
}

function getDefaultFeedbackDir() {
  return getFeedbackPaths().FEEDBACK_DIR;
}

function toBundleRelativePath(...segments) {
  return path.posix.join(...segments);
}

function normalizeBundleRelativePath(relativePath) {
  return String(relativePath || '').replace(/\\/g, '/');
}

function walkJsonFiles(dirPath, acc = []) {
  if (!fs.existsSync(dirPath)) return acc;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkJsonFiles(fullPath, acc);
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      acc.push(fullPath);
    }
  }
  return acc;
}

function annotateRows(rows, dataset, sourceFile, exportedAt) {
  return rows.map((row, index) => ({
    bundleDataset: dataset,
    bundleRowNumber: index + 1,
    bundleExportedAt: exportedAt,
    bundleSourceFile: sourceFile,
    ...row,
  }));
}

function collectProofReports(proofDir, exportedAt) {
  return walkJsonFiles(proofDir)
    .map((filePath, index) => ({
      bundleDataset: 'proof_reports',
      bundleRowNumber: index + 1,
      bundleExportedAt: exportedAt,
      reportId: path.basename(filePath, '.json'),
      reportCategory: path.basename(path.dirname(filePath)),
      reportPath: normalizeBundleRelativePath(path.relative(proofDir, filePath)),
      report: readJSON(filePath),
    }))
    .filter((row) => row.report);
}

function buildSqlTemplate(manifest) {
  const lines = [
    '-- Databricks bootstrap for the exported analytics bundle.',
    '-- Replace __CATALOG__, __SCHEMA__, and __BUNDLE_ROOT__ before running.',
    '',
    'CREATE SCHEMA IF NOT EXISTS __CATALOG__.__SCHEMA__;',
    '',
  ];

  for (const table of manifest.tables) {
    lines.push(`CREATE OR REPLACE TABLE __CATALOG__.__SCHEMA__.${table.tableName} AS`);
    lines.push('SELECT *, _metadata.file_path AS source_file');
    lines.push(`FROM read_files('__BUNDLE_ROOT__/${normalizeBundleRelativePath(table.relativePath)}', format => 'json');`);
    lines.push('');
  }

  return lines.join('\n');
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function exportDatabricksBundle(feedbackDir = getDefaultFeedbackDir(), outputPath, options = {}) {
  const resolvedFeedbackDir = path.resolve(feedbackDir || getDefaultFeedbackDir());
  const resolvedProofDir = path.resolve(options.proofDir || DEFAULT_PROOF_DIR);
  const exportedAt = new Date().toISOString();
  const bundlePath = path.resolve(outputPath || path.join(
    resolvedFeedbackDir,
    'analytics',
    `databricks-${timestampSlug()}`
  ));
  const tablesDir = path.join(bundlePath, 'tables');
  ensureDir(tablesDir);

  const datasets = [
    {
      tableName: 'feedback_events',
      sourcePath: path.join(resolvedFeedbackDir, 'feedback-log.jsonl'),
      description: 'Raw ThumbGate feedback events from feedback-log.jsonl',
    },
    {
      tableName: 'memory_records',
      sourcePath: path.join(resolvedFeedbackDir, 'memory-log.jsonl'),
      description: 'Promoted learning and mistake memories from memory-log.jsonl',
    },
    {
      tableName: 'feedback_sequences',
      sourcePath: path.join(resolvedFeedbackDir, 'feedback-sequences.jsonl'),
      description: 'Sequence-model training rows derived from accepted feedback',
    },
    {
      tableName: 'feedback_attributions',
      sourcePath: path.join(resolvedFeedbackDir, 'attributed-feedback.jsonl'),
      description: 'Tool-call attribution rows for negative feedback events',
    },
  ];

  const tables = datasets.map((dataset) => {
    const rows = annotateRows(
      readJSONL(dataset.sourcePath),
      dataset.tableName,
      path.basename(dataset.sourcePath),
      exportedAt,
    );
    const fileName = `${dataset.tableName}.jsonl`;
    const relativePath = toBundleRelativePath('tables', fileName);
    writeJSONL(path.join(tablesDir, fileName), rows);
    return {
      tableName: dataset.tableName,
      relativePath,
      rowCount: rows.length,
      description: dataset.description,
    };
  });

  const proofRows = collectProofReports(resolvedProofDir, exportedAt);
  const proofRelativePath = toBundleRelativePath('tables', 'proof_reports.jsonl');
  writeJSONL(path.join(tablesDir, 'proof_reports.jsonl'), proofRows);
  tables.push({
    tableName: 'proof_reports',
    relativePath: proofRelativePath,
    rowCount: proofRows.length,
    description: 'Machine-readable proof artifacts discovered under proof/**/*.json',
  });

  const manifest = {
    format: 'databricks-analytics-bundle',
    version: 1,
    exportedAt,
    bundlePath,
    feedbackDir: resolvedFeedbackDir,
    proofDir: resolvedProofDir,
    placeholders: {
      catalog: '__CATALOG__',
      schema: '__SCHEMA__',
      bundleRoot: '__BUNDLE_ROOT__',
    },
    tables,
  };

  const manifestPath = path.join(bundlePath, 'manifest.json');
  const sqlTemplatePath = path.join(bundlePath, 'load_databricks.sql');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(sqlTemplatePath, buildSqlTemplate(manifest) + '\n');

  return {
    bundlePath,
    manifestPath,
    sqlTemplatePath,
    tableCount: tables.length,
    totalRows: tables.reduce((sum, table) => sum + table.rowCount, 0),
    tables,
  };
}

module.exports = {
  DEFAULT_PROOF_DIR,
  buildSqlTemplate,
  collectProofReports,
  exportDatabricksBundle,
  getDefaultFeedbackDir,
  readJSONL,
  toBundleRelativePath,
};

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const result = exportDatabricksBundle(
    args['feedback-dir'],
    args.output,
    { proofDir: args['proof-dir'] }
  );
  console.log(JSON.stringify(result, null, 2));
}
