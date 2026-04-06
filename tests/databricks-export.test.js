'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  exportDatabricksBundle,
  toBundleRelativePath,
} = require('../scripts/export-databricks-bundle');

function writeJsonl(filePath, rows) {
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

describe('exportDatabricksBundle', () => {
  it('writes manifest, sql template, and analytics tables', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-dbx-'));
    const feedbackDir = path.join(tmpDir, 'feedback');
    const proofDir = path.join(tmpDir, 'proof');
    const outputDir = path.join(tmpDir, 'bundle');
    fs.mkdirSync(feedbackDir, { recursive: true });
    fs.mkdirSync(path.join(proofDir, 'automation'), { recursive: true });

    writeJsonl(path.join(feedbackDir, 'feedback-log.jsonl'), [
      { id: 'fb_1', signal: 'negative', context: 'Missed test evidence', tags: ['testing'] },
    ]);
    writeJsonl(path.join(feedbackDir, 'memory-log.jsonl'), [
      { id: 'mem_1', category: 'error', title: 'MISTAKE: skipped tests', tags: ['testing'] },
    ]);
    writeJsonl(path.join(feedbackDir, 'feedback-sequences.jsonl'), [
      { id: 'seq_1', label: 'high-risk', targetReward: -1 },
    ]);
    writeJsonl(path.join(feedbackDir, 'attributed-feedback.jsonl'), [
      { id: 'attr_1', actionId: 'action_1', confidence: 0.92 },
    ]);
    fs.writeFileSync(
      path.join(proofDir, 'automation', 'report.json'),
      JSON.stringify({ checks: [{ id: 'AUTO-01', passed: true }] }, null, 2)
    );

    const result = exportDatabricksBundle(feedbackDir, outputDir, { proofDir });
    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
    const feedbackRows = fs.readFileSync(path.join(outputDir, 'tables', 'feedback_events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse);
    const sql = fs.readFileSync(result.sqlTemplatePath, 'utf8');

    assert.equal(result.bundlePath, outputDir);
    assert.equal(result.tableCount, 5);
    assert.equal(manifest.format, 'databricks-analytics-bundle');
    assert.equal(manifest.tables.find((table) => table.tableName === 'feedback_events').rowCount, 1);
    assert.equal(manifest.tables.find((table) => table.tableName === 'proof_reports').rowCount, 1);
    assert.equal(feedbackRows[0].bundleDataset, 'feedback_events');
    assert.equal(feedbackRows[0].id, 'fb_1');
    assert.match(sql, /CREATE OR REPLACE TABLE __CATALOG__\.__SCHEMA__\.feedback_events/);
    assert.match(sql, /read_files\('__BUNDLE_ROOT__\/tables\/proof_reports\.jsonl', format => 'json'\)/);
  });

  it('handles missing optional inputs by emitting empty tables', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-dbx-empty-'));
    const feedbackDir = path.join(tmpDir, 'feedback');
    const outputDir = path.join(tmpDir, 'bundle');
    fs.mkdirSync(feedbackDir, { recursive: true });

    const result = exportDatabricksBundle(feedbackDir, outputDir, { proofDir: path.join(tmpDir, 'missing-proof') });
    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
    assert.equal(manifest.tables.every((table) => table.rowCount === 0), true);
  });

  it('defaults to the active feedback directory discovery logic when feedbackDir is omitted', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-dbx-default-'));
    const projectDir = path.join(tmpDir, 'project');
    const proofDir = path.join(tmpDir, 'proof');
    const previousCwd = process.cwd();
    const previousFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
    const previousProofDir = process.env.THUMBGATE_PROOF_DIR;

    fs.mkdirSync(path.join(projectDir, '.thumbgate'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.claude', 'memory', 'feedback'), { recursive: true });
    fs.mkdirSync(proofDir, { recursive: true });

    delete process.env.THUMBGATE_FEEDBACK_DIR;
    delete process.env.THUMBGATE_PROOF_DIR;

    try {
      process.chdir(projectDir);
      const result = exportDatabricksBundle(undefined, undefined, { proofDir });
      assert.match(result.bundlePath, new RegExp(`[\\\\/]\\.thumbgate[\\\\/]analytics[\\\\/]databricks-`));
    } finally {
      process.chdir(previousCwd);
      if (previousFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
      else process.env.THUMBGATE_FEEDBACK_DIR = previousFeedbackDir;
      if (previousProofDir === undefined) delete process.env.THUMBGATE_PROOF_DIR;
      else process.env.THUMBGATE_PROOF_DIR = previousProofDir;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('normalizes bundle-relative paths to POSIX separators', () => {
    assert.equal(toBundleRelativePath('tables', 'feedback_events.jsonl'), 'tables/feedback_events.jsonl');
    assert.equal(toBundleRelativePath('tables', 'nested', 'proof_reports.jsonl'), 'tables/nested/proof_reports.jsonl');
  });
});
