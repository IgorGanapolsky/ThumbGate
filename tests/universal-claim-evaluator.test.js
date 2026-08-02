'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseFactualClaims,
  evaluateUniversalClaims,
  assertSelectOnly,
  resolveSafePath,
} = require('../scripts/universal-claim-evaluator');
const { verifyClaimEvidence, clearSessionActions } = require('../scripts/gates-engine');

describe('parseFactualClaims', () => {
  it('parses comma-formatted row counts', () => {
    const claims = parseFactualClaims('the row count is 1,284');
    assert.equal(claims.length, 1);
    assert.equal(claims[0].kind, 'count');
    assert.equal(claims[0].expected, 1284);
    assert.match(claims[0].subject, /row count/);
  });

  it('parses there-are-N-rows phrasing', () => {
    const claims = parseFactualClaims('There are 42 orders in the table.');
    assert.equal(claims.length, 1);
    assert.equal(claims[0].expected, 42);
    assert.equal(claims[0].subject, 'orders');
  });

  it('parses file line and existence claims', () => {
    const claims = parseFactualClaims('file README.md has 10 lines and secrets.env does not exist');
    assert.ok(claims.some((c) => c.kind === 'file_lines' && c.path === 'README.md' && c.expected === 10));
    assert.ok(claims.some((c) => c.kind === 'file_exists' && c.path === 'secrets.env' && c.expected === false));
  });

  it('parses package version claims', () => {
    const claims = parseFactualClaims('package version is 1.31.0');
    assert.equal(claims.length, 1);
    assert.equal(claims[0].kind, 'value');
    assert.equal(claims[0].expected, '1.31.0');
  });
});

describe('sql safety', () => {
  it('rejects non-SELECT sqlite queries', () => {
    assert.throws(() => assertSelectOnly('DELETE FROM orders'), /SELECT-only/);
    assert.throws(() => assertSelectOnly('SELECT 1; DROP TABLE x'), /single statement/);
  });

  it('blocks path escape outside repo root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-claim-root-'));
    assert.throws(() => resolveSafePath(root, '../outside.txt'), /escapes repo root/);
    assert.throws(() => resolveSafePath(root, '/etc/passwd'), /absolute paths/);
  });
});

describe('evaluateUniversalClaims', () => {
  let tmpDir;
  let dbPath;
  let readmePath;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-universal-claim-'));
    fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
    readmePath = path.join(tmpDir, 'README.md');
    fs.writeFileSync(readmePath, 'one\ntwo\nthree\n');
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ version: '9.9.9' }));

    const Database = require('better-sqlite3');
    dbPath = path.join(tmpDir, 'data', 'app.sqlite');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY); INSERT INTO orders (id) VALUES (1),(2),(3);');
    db.close();
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const verifiers = () => ([
    {
      id: 'orders-row-count',
      kind: 'sqlite_count',
      match: { kinds: ['count'], subjects: ['row count', 'rows', 'orders'] },
      dbPath: 'data/app.sqlite',
      query: 'SELECT COUNT(*) AS n FROM orders',
    },
    {
      id: 'readme-lines',
      kind: 'file_lines',
      match: { kinds: ['file_lines'], paths: ['README.md'] },
      path: 'README.md',
    },
    {
      id: 'package-version',
      kind: 'json_path',
      match: { kinds: ['value'], subjects: ['version', 'package version'] },
      path: 'package.json',
      jsonPath: 'version',
    },
  ]);

  it('passes when row count matches the database', () => {
    const result = evaluateUniversalClaims('the row count is 3', {
      cwd: tmpDir,
      verifiers: verifiers(),
    });
    assert.equal(result.verified, true);
    assert.equal(result.checks[0].status, 'match');
    assert.equal(result.checks[0].actual, 3);
  });

  it('fails closed on row-count mismatch', () => {
    const result = evaluateUniversalClaims('the row count is 1,284', {
      cwd: tmpDir,
      verifiers: verifiers(),
    });
    assert.equal(result.verified, false);
    assert.equal(result.checks[0].status, 'mismatch');
    assert.equal(result.checks[0].expected, 1284);
    assert.equal(result.checks[0].actual, 3);
  });

  it('fails closed when a claim is parseable but no verifier is configured', () => {
    const result = evaluateUniversalClaims('the row count is 3', {
      cwd: tmpDir,
      verifiers: [],
    });
    assert.equal(result.verified, false);
    assert.equal(result.checks[0].status, 'unconfigured');
  });

  it('verifies file line counts and package version', () => {
    const result = evaluateUniversalClaims(
      'file README.md has 3 lines and package version is 9.9.9',
      { cwd: tmpDir, verifiers: verifiers() },
    );
    assert.equal(result.verified, true);
    assert.equal(result.checks.length, 2);
  });
});

describe('verifyClaimEvidence integration', () => {
  it('blocks require-evidence style claims when universal factual checks fail', () => {
    clearSessionActions();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-claim-int-'));
    try {
      const result = verifyClaimEvidence('the row count is 99', {
        cwd: tmpDir,
        verifiers: [{
          id: 'rows',
          kind: 'sqlite_count',
          match: { subjects: ['row count'] },
          dbPath: 'missing.sqlite',
          query: 'SELECT COUNT(*) FROM t',
        }],
      });
      assert.equal(result.verified, false);
      assert.ok(result.universal);
      assert.ok(result.checks.some((c) => String(c.claim).startsWith('universal:') || c.universal));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      clearSessionActions();
    }
  });
});
