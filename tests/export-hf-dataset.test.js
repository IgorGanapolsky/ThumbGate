'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  exportHfDataset,
  buildTraceRow,
  buildPreferenceRow,
  buildDatasetInfo,
  redactPaths,
  redactEntry,
} = require('../scripts/export-hf-dataset');

describe('export-hf-dataset', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-export-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // PII redaction
  // -----------------------------------------------------------------------
  describe('redactPaths', () => {
    it('redacts Unix home paths', () => {
      assert.strictEqual(
        redactPaths('/Users/igorganapolsky/workspace/file.js'),
        '/Users/redacted/workspace/file.js',
      );
    });

    it('redacts Linux home paths', () => {
      assert.strictEqual(
        redactPaths('/home/developer/project/main.py'),
        '/home/redacted/project/main.py',
      );
    });

    it('redacts Windows paths', () => {
      assert.strictEqual(
        redactPaths('C:\\Users\\Developer\\code\\app.js'),
        'C:\\Users\\redacted\\code\\app.js',
      );
    });

    it('handles null/empty gracefully', () => {
      assert.strictEqual(redactPaths(null), '');
      assert.strictEqual(redactPaths(''), '');
      assert.strictEqual(redactPaths(undefined), '');
    });

    it('leaves non-path text unchanged', () => {
      assert.strictEqual(redactPaths('just some text'), 'just some text');
    });
  });

  describe('redactEntry', () => {
    it('redacts string fields in an object', () => {
      const result = redactEntry({
        context: '/Users/dev/project/file.js failed',
        tags: ['/Users/dev/logs', 'error'],
        count: 5,
      });
      assert.ok(!result.context.includes('/Users/dev'));
      assert.ok(!result.tags[0].includes('/Users/dev'));
      assert.strictEqual(result.count, 5);
    });

    it('handles null/undefined', () => {
      assert.strictEqual(redactEntry(null), null);
      assert.strictEqual(redactEntry(undefined), undefined);
    });
  });

  // -----------------------------------------------------------------------
  // Trace row builder
  // -----------------------------------------------------------------------
  describe('buildTraceRow', () => {
    it('builds a trace row from a feedback entry', () => {
      const entry = {
        id: 'fb_001',
        timestamp: '2026-04-08T00:00:00Z',
        signal: 'down',
        toolName: 'Bash',
        context: 'Ran rm -rf in wrong dir',
        whatWentWrong: 'Deleted production data',
        whatToChange: 'Add path validation',
        tags: ['destructive', 'bash'],
        failureType: 'execution',
      };
      const row = buildTraceRow(entry, 0);
      assert.strictEqual(row.trace_id, 'fb_001');
      assert.strictEqual(row.signal, 'down');
      assert.strictEqual(row.tool_name, 'Bash');
      assert.strictEqual(row.failure_type, 'execution');
      assert.deepStrictEqual(row.tags, ['destructive', 'bash']);
      assert.strictEqual(row.source, 'thumbgate');
    });

    it('uses index-based ID when entry has no id', () => {
      const row = buildTraceRow({}, 42);
      assert.strictEqual(row.trace_id, 'trace_42');
      assert.strictEqual(row.signal, 'unknown');
      assert.strictEqual(row.tool_name, 'unknown');
    });
  });

  // -----------------------------------------------------------------------
  // Preference row builder
  // -----------------------------------------------------------------------
  describe('buildPreferenceRow', () => {
    it('builds a preference row from a DPO pair', () => {
      const pair = {
        prompt: 'How should the agent handle test verification?',
        chosen: 'Run tests and show output before claiming done',
        rejected: 'Claim done without evidence',
        metadata: {
          matchScore: 3,
          matchedKeys: ['verification', 'testing'],
          rubric: { weightedDelta: 0.57 },
        },
      };
      const row = buildPreferenceRow(pair, 0);
      assert.strictEqual(row.pair_id, 'pref_0');
      assert.strictEqual(row.match_score, 3);
      assert.strictEqual(row.rubric_delta, 0.57);
      assert.deepStrictEqual(row.matched_keys, ['verification', 'testing']);
      assert.strictEqual(row.source, 'thumbgate');
    });

    it('handles missing metadata gracefully', () => {
      const row = buildPreferenceRow({ prompt: 'test' }, 1);
      assert.strictEqual(row.pair_id, 'pref_1');
      assert.strictEqual(row.match_score, null);
      assert.strictEqual(row.rubric_delta, null);
    });
  });

  // -----------------------------------------------------------------------
  // Dataset info builder
  // -----------------------------------------------------------------------
  describe('buildDatasetInfo', () => {
    it('builds valid dataset info with correct counts', () => {
      const info = buildDatasetInfo({
        traceCount: 100,
        preferenceCount: 25,
        exportedAt: '2026-04-08T00:00:00Z',
      });
      assert.strictEqual(info.dataset_info.splits.traces.num_examples, 100);
      assert.strictEqual(info.dataset_info.splits.preferences.num_examples, 25);
      assert.ok(info.dataset_info.description.includes('ThumbGate'));
      assert.strictEqual(info.version, '1.0.0');
      assert.strictEqual(info.exporter, 'thumbgate/export-hf-dataset');
    });

    it('includes feature schemas for both splits', () => {
      const info = buildDatasetInfo({ traceCount: 0, preferenceCount: 0, exportedAt: '' });
      assert.ok(info.dataset_info.features.traces.trace_id);
      assert.ok(info.dataset_info.features.traces.signal);
      assert.ok(info.dataset_info.features.preferences.prompt);
      assert.ok(info.dataset_info.features.preferences.chosen);
      assert.ok(info.dataset_info.features.preferences.rejected);
    });
  });

  // -----------------------------------------------------------------------
  // Full export integration
  // -----------------------------------------------------------------------
  describe('exportHfDataset', () => {
    it('exports to the specified output directory', () => {
      const feedbackDir = path.join(tmpDir, 'feedback');
      const outputDir = path.join(tmpDir, 'hf-output');
      fs.mkdirSync(feedbackDir, { recursive: true });

      // Write sample feedback log
      const feedbackEntries = [
        { id: 'fb1', signal: 'up', toolName: 'Edit', context: 'Fixed bug', tags: ['fix'] },
        { id: 'fb2', signal: 'down', toolName: 'Bash', context: 'Wrong command', whatWentWrong: 'Typo', tags: ['bash'] },
      ];
      fs.writeFileSync(
        path.join(feedbackDir, 'feedback-log.jsonl'),
        feedbackEntries.map((e) => JSON.stringify(e)).join('\n') + '\n',
      );

      // Write sample memory log
      const memories = [
        { id: 'm1', title: 'MISTAKE: no tests', content: 'Skipped tests', category: 'error', tags: ['testing'] },
        { id: 'm2', title: 'SUCCESS: added tests', content: 'Always run tests', category: 'learning', tags: ['testing'] },
      ];
      fs.writeFileSync(
        path.join(feedbackDir, 'memory-log.jsonl'),
        memories.map((m) => JSON.stringify(m)).join('\n') + '\n',
      );

      const result = exportHfDataset({
        feedbackDir,
        outputDir,
        includeProvenance: false,
      });

      // Verify output files exist
      assert.ok(fs.existsSync(path.join(outputDir, 'traces.jsonl')));
      assert.ok(fs.existsSync(path.join(outputDir, 'preferences.jsonl')));
      assert.ok(fs.existsSync(path.join(outputDir, 'dataset_info.json')));

      // Verify trace count
      assert.strictEqual(result.traceCount, 2);
      assert.ok(result.preferenceCount >= 0);
      assert.deepStrictEqual(result.files, ['traces.jsonl', 'preferences.jsonl', 'dataset_info.json']);

      // Verify traces content
      const traces = fs.readFileSync(path.join(outputDir, 'traces.jsonl'), 'utf8')
        .trim().split('\n').map(JSON.parse);
      assert.strictEqual(traces[0].trace_id, 'fb1');
      assert.strictEqual(traces[0].signal, 'up');
      assert.strictEqual(traces[1].tool_name, 'Bash');

      // Verify dataset_info
      const info = JSON.parse(fs.readFileSync(path.join(outputDir, 'dataset_info.json'), 'utf8'));
      assert.strictEqual(info.dataset_info.splits.traces.num_examples, 2);
      assert.strictEqual(info.exporter, 'thumbgate/export-hf-dataset');
    });

    it('handles empty feedback directory gracefully', () => {
      const feedbackDir = path.join(tmpDir, 'empty-feedback');
      const outputDir = path.join(tmpDir, 'hf-empty');
      fs.mkdirSync(feedbackDir, { recursive: true });

      const result = exportHfDataset({
        feedbackDir,
        outputDir,
        includeProvenance: false,
      });

      assert.strictEqual(result.traceCount, 0);
      assert.strictEqual(result.preferenceCount, 0);
      assert.ok(fs.existsSync(path.join(outputDir, 'dataset_info.json')));
    });

    it('redacts paths in exported trace rows', () => {
      const feedbackDir = path.join(tmpDir, 'redact-feedback');
      const outputDir = path.join(tmpDir, 'hf-redact');
      fs.mkdirSync(feedbackDir, { recursive: true });

      fs.writeFileSync(
        path.join(feedbackDir, 'feedback-log.jsonl'),
        JSON.stringify({
          id: 'fb_pii',
          signal: 'down',
          context: '/Users/igorganapolsky/workspace/project/file.js crashed',
        }) + '\n',
      );

      exportHfDataset({ feedbackDir, outputDir, includeProvenance: false });

      const traces = fs.readFileSync(path.join(outputDir, 'traces.jsonl'), 'utf8')
        .trim().split('\n').map(JSON.parse);
      assert.ok(!traces[0].context.includes('igorganapolsky'));
      assert.ok(traces[0].context.includes('/Users/redacted'));
    });
  });
});
