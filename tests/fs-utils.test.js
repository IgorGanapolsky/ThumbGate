'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  ensureDir,
  ensureParentDir,
  readJsonl,
  readJsonlTail,
  readTextTail,
  appendJsonl,
  writeJson,
} = require('../scripts/fs-utils');

describe('fs-utils', () => {
  describe('ensureDir', () => {
    it('creates nested directories', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fsutils-'));
      const nested = path.join(tmp, 'a', 'b', 'c');
      ensureDir(nested);
      assert.ok(fs.existsSync(nested));
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('is idempotent on existing dirs', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fsutils-'));
      ensureDir(tmp);
      assert.ok(fs.existsSync(tmp));
      fs.rmSync(tmp, { recursive: true, force: true });
    });
  });

  describe('ensureParentDir', () => {
    it('creates the parent directory for a file path', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fsutils-'));
      const targetFile = path.join(tmp, 'parent', 'child', 'data.jsonl');
      ensureParentDir(targetFile);
      assert.ok(fs.existsSync(path.dirname(targetFile)));
      fs.rmSync(tmp, { recursive: true, force: true });
    });
  });

  describe('readJsonl', () => {
    it('returns empty array for missing file', () => {
      assert.deepStrictEqual(readJsonl('/tmp/nonexistent-fsutils.jsonl'), []);
    });

    it('parses valid JSONL', () => {
      const tmp = path.join(os.tmpdir(), 'fsutils-read.jsonl');
      fs.writeFileSync(tmp, '{"a":1}\n{"b":2}\n');
      const result = readJsonl(tmp);
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].a, 1);
      assert.strictEqual(result[1].b, 2);
      fs.unlinkSync(tmp);
    });

    it('skips malformed lines', () => {
      const tmp = path.join(os.tmpdir(), 'fsutils-malformed.jsonl');
      fs.writeFileSync(tmp, '{"a":1}\ngarbage\n{"b":2}\n');
      const result = readJsonl(tmp);
      assert.strictEqual(result.length, 2);
      fs.unlinkSync(tmp);
    });

    it('respects maxLines option', () => {
      const tmp = path.join(os.tmpdir(), 'fsutils-max.jsonl');
      fs.writeFileSync(tmp, '{"a":1}\n{"b":2}\n{"c":3}\n');
      const result = readJsonl(tmp, { maxLines: 2 });
      assert.strictEqual(result.length, 2);
      fs.unlinkSync(tmp);
    });

    it('reads in reverse when requested', () => {
      const tmp = path.join(os.tmpdir(), 'fsutils-rev.jsonl');
      fs.writeFileSync(tmp, '{"a":1}\n{"b":2}\n{"c":3}\n');
      const result = readJsonl(tmp, { reverse: true, maxLines: 2 });
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].c, 3);
      assert.strictEqual(result[1].b, 2);
      fs.unlinkSync(tmp);
    });

    it('supports numeric max lines as a chronological tail read', () => {
      const tmp = path.join(os.tmpdir(), 'fsutils-tail-number.jsonl');
      fs.writeFileSync(tmp, '{"a":1}\n{"b":2}\n{"c":3}\n');
      const result = readJsonl(tmp, 2);
      assert.deepStrictEqual(result.map((row) => Object.keys(row)[0]), ['b', 'c']);
      fs.unlinkSync(tmp);
    });

    it('supports explicit chronological tail reads', () => {
      const tmp = path.join(os.tmpdir(), 'fsutils-tail.jsonl');
      fs.writeFileSync(tmp, '{"a":1}\n{"b":2}\n{"c":3}\n');
      const result = readJsonlTail(tmp, 2);
      assert.deepStrictEqual(result.map((row) => Object.keys(row)[0]), ['b', 'c']);
      fs.unlinkSync(tmp);
    });

    it('tails large files by maxBytes', () => {
      const tmp = path.join(os.tmpdir(), 'fsutils-maxbytes.jsonl');
      const lines = [];
      for (let i = 0; i < 400; i += 1) {
        lines.push(JSON.stringify({ id: `id${i}`, pad: 'y'.repeat(80) }));
      }
      fs.writeFileSync(tmp, `${lines.join('\n')}\n`);
      const rows = readJsonl(tmp, { maxLines: 20, tail: true, maxBytes: 4_000 });
      assert.ok(rows.length > 0);
      assert.ok(rows.length <= 20);
      assert.notEqual(rows[0].id, 'id0');
      fs.unlinkSync(tmp);
    });
  });

  describe('readTextTail', () => {
    it('returns the full file when it fits the budget', () => {
      const tmp = path.join(os.tmpdir(), 'fsutils-text-full.txt');
      fs.writeFileSync(tmp, 'alpha\nbeta\n');
      const result = readTextTail(tmp, 1024);
      assert.equal(result.truncated, false);
      assert.match(result.text, /alpha/);
      fs.unlinkSync(tmp);
    });

    it('drops the incomplete first line after a mid-file seek', () => {
      const tmp = path.join(os.tmpdir(), 'fsutils-text-tail.txt');
      fs.writeFileSync(tmp, `${'a'.repeat(80)}\nnewest\n`);
      const result = readTextTail(tmp, 20);
      assert.equal(result.truncated, true);
      assert.match(result.text, /newest/);
      fs.unlinkSync(tmp);
    });
  });

  describe('appendJsonl', () => {
    it('appends to file and creates dirs', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fsutils-'));
      const fp = path.join(tmp, 'sub', 'test.jsonl');
      appendJsonl(fp, { x: 1 });
      appendJsonl(fp, { y: 2 });
      const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
      assert.strictEqual(lines.length, 2);
      fs.rmSync(tmp, { recursive: true, force: true });
    });
  });

  describe('writeJson', () => {
    it('writes pretty-printed JSON', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fsutils-'));
      const fp = path.join(tmp, 'test.json');
      writeJson(fp, { key: 'value' });
      const content = fs.readFileSync(fp, 'utf8');
      assert.ok(content.includes('"key": "value"'));
      fs.rmSync(tmp, { recursive: true, force: true });
    });
  });
});
