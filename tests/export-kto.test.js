'use strict';

/**
 * KTO Export tests
 * Validates binary feedback -> KTO JSONL transformation.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('export-kto-pairs', () => {
  let kto;

  before(() => {
    delete require.cache[require.resolve('../scripts/export-kto-pairs.js')];
    kto = require('../scripts/export-kto-pairs.js');
  });

  describe('buildKtoRecord', () => {
    it('positive signal produces label: true', () => {
      const record = kto.buildKtoRecord({
        id: 'fb_pos',
        signal: 'positive',
        context: 'Implemented feature with tests',
        whatWorked: 'Evidence-first approach',
        tags: ['verification'],
        timestamp: '2025-06-01T12:00:00Z',
      });
      assert.ok(record, 'record should not be null');
      assert.equal(record.label, true);
      assert.equal(record.completion, 'Evidence-first approach');
    });

    it('negative signal produces label: false', () => {
      const record = kto.buildKtoRecord({
        id: 'fb_neg',
        signal: 'negative',
        context: 'Deployment attempt',
        whatWentWrong: 'Missing environment variables',
        tags: ['deploy'],
        timestamp: '2025-06-01T13:00:00Z',
      });
      assert.ok(record, 'record should not be null');
      assert.equal(record.label, false);
      assert.equal(record.completion, 'Missing environment variables');
    });

    it('missing context is handled gracefully', () => {
      const record = kto.buildKtoRecord({
        id: 'fb_noctx',
        signal: 'up',
        tags: ['testing', 'auth'],
      });
      assert.ok(record, 'record should not be null');
      assert.equal(record.prompt, 'Task: testing, auth');
      assert.equal(record.label, true);
    });

    it('completely empty entry with valid signal still works', () => {
      const record = kto.buildKtoRecord({ signal: 'down' });
      assert.ok(record, 'record should not be null');
      assert.equal(record.label, false);
      assert.equal(record.prompt, 'General coding task');
    });

    it('invalid signal returns null', () => {
      const record = kto.buildKtoRecord({ id: 'bad', signal: 'maybe' });
      assert.equal(record, null);
    });
  });

  describe('metadata', () => {
    it('includes signal source and timestamp', () => {
      const record = kto.buildKtoRecord({
        id: 'fb_meta',
        signal: 'positive',
        context: 'Test context',
        timestamp: '2025-06-15T08:30:00Z',
      });
      assert.ok(record.metadata, 'metadata should exist');
      assert.equal(record.metadata.signalSource, 'feedback-log');
      assert.equal(record.metadata.timestamp, '2025-06-15T08:30:00Z');
      assert.equal(record.metadata.signal, 'positive');
      assert.equal(record.metadata.sourceId, 'fb_meta');
    });

    it('includes domain from richContext', () => {
      const record = kto.buildKtoRecord({
        id: 'fb_rich',
        signal: 'up',
        richContext: { domain: 'security', outcomeCategory: 'deep-success' },
      });
      assert.equal(record.metadata.domain, 'security');
      assert.equal(record.metadata.outcomeCategory, 'deep-success');
    });

    it('includes rubric score when present', () => {
      const record = kto.buildKtoRecord({
        id: 'fb_rubric',
        signal: 'positive',
        context: 'With rubric',
        rubric: { weightedScore: 0.85 },
      });
      assert.equal(record.metadata.rubricScore, 0.85);
    });

    it('rubric score is null when absent', () => {
      const record = kto.buildKtoRecord({
        id: 'fb_norubric',
        signal: 'positive',
        context: 'No rubric',
      });
      assert.equal(record.metadata.rubricScore, null);
    });
  });

  describe('toJSONL', () => {
    it('output is valid JSONL', () => {
      const records = [
        { prompt: 'a', completion: 'b', label: true, metadata: {} },
        { prompt: 'c', completion: 'd', label: false, metadata: {} },
      ];
      const jsonl = kto.toJSONL(records);
      const lines = jsonl.trim().split('\n');
      assert.equal(lines.length, 2);
      for (const line of lines) {
        assert.doesNotThrow(() => JSON.parse(line), 'each line must be valid JSON');
      }
    });

    it('ends with newline', () => {
      const jsonl = kto.toJSONL([{ prompt: 'x', completion: 'y', label: true, metadata: {} }]);
      assert.ok(jsonl.endsWith('\n'));
    });

    it('empty input produces empty string', () => {
      assert.equal(kto.toJSONL([]), '');
    });
  });

  describe('buildKtoPairs', () => {
    it('filters entries with invalid signals', () => {
      const result = kto.buildKtoPairs([
        { id: '1', signal: 'up', context: 'good' },
        { id: '2', signal: 'invalid' },
        { id: '3', signal: 'down', context: 'bad', whatWentWrong: 'broke' },
      ]);
      assert.equal(result.records.length, 2);
      assert.equal(result.skipped.length, 1);
      assert.equal(result.skipped[0].id, '2');
    });
  });

  describe('exportKtoFromFeedback', () => {
    it('deduplicates entries by id', () => {
      const entries = [
        { id: 'dup_1', signal: 'up', context: 'same' },
        { id: 'dup_1', signal: 'up', context: 'same' },
      ];
      const result = kto.exportKtoFromFeedback(entries, []);
      assert.equal(result.records.length, 1);
      assert.equal(result.totalInput, 1);
    });

    it('merges feedback and memory entries', () => {
      const feedback = [{ id: 'fb_1', signal: 'up', context: 'a' }];
      const memory = [{ id: 'mem_1', signal: 'down', context: 'b', sourceFeedbackId: 'fb_x' }];
      const result = kto.exportKtoFromFeedback(feedback, memory);
      assert.equal(result.records.length, 2);
      // Memory entry should be tagged as memory-log source
      const memRecord = result.records.find((r) => r.metadata.sourceId === 'mem_1');
      assert.equal(memRecord.metadata.signalSource, 'memory-log');
    });

    it('produces valid jsonl field', () => {
      const result = kto.exportKtoFromFeedback(
        [{ id: 'fb_v', signal: 'positive', context: 'test' }],
        [],
      );
      assert.ok(result.jsonl.endsWith('\n'));
      const parsed = JSON.parse(result.jsonl.trim());
      assert.equal(parsed.label, true);
    });
  });

  describe('file I/O', () => {
    let tmpDir;
    let origEnv;

    before(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kto-test-'));
      origEnv = process.env.THUMBGATE_FEEDBACK_DIR;
      process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
    });

    after(() => {
      if (origEnv !== undefined) {
        process.env.THUMBGATE_FEEDBACK_DIR = origEnv;
      } else {
        delete process.env.THUMBGATE_FEEDBACK_DIR;
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('readJSONL returns empty array for missing file', () => {
      const result = kto.readJSONL(path.join(tmpDir, 'nonexistent.jsonl'));
      assert.deepEqual(result, []);
    });

    it('readJSONL parses valid JSONL', () => {
      const filePath = path.join(tmpDir, 'test.jsonl');
      fs.writeFileSync(filePath, '{"a":1}\n{"b":2}\n');
      const result = kto.readJSONL(filePath);
      assert.equal(result.length, 2);
      assert.equal(result[0].a, 1);
    });

    it('readJSONL skips malformed lines', () => {
      const filePath = path.join(tmpDir, 'bad.jsonl');
      fs.writeFileSync(filePath, '{"ok":true}\nnot-json\n{"also":"ok"}\n');
      const result = kto.readJSONL(filePath);
      assert.equal(result.length, 2);
    });
  });
});
