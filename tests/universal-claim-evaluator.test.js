'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('node:child_process');

const {
  parseFactualClaims,
  evaluateUniversalClaims,
  loadVerifierConfig,
  assertSelectOnly,
  resolveSafePath,
  pathMatches,
  runCli,
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

  it('does not parse count inside unrelated words', () => {
    assert.deepEqual(parseFactualClaims('the discount is 10%'), []);
    assert.deepEqual(parseFactualClaims('the account is 6'), []);
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

  it('requires exact normalized file-path matches', () => {
    assert.equal(pathMatches('./README.md', ['README.md']), true);
    assert.equal(pathMatches('fake/README.md', ['README.md']), false);
  });

  it('blocks an in-root symlink that resolves outside the root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-claim-root-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-claim-outside-'));
    fs.writeFileSync(path.join(outside, 'truth.txt'), 'outside\n');
    fs.symlinkSync(outside, path.join(root, 'linked'));
    assert.throws(
      () => resolveSafePath(root, 'linked/truth.txt'),
      /resolves outside repo root through a symlink/,
    );
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
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
    fs.mkdirSync(path.join(tmpDir, 'fake'));
    fs.writeFileSync(path.join(tmpDir, 'fake', 'README.md'), 'spoof\n'.repeat(99));
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

  it('reads the operator-configured file instead of a claimed lookalike path', () => {
    const result = evaluateUniversalClaims('file fake/README.md has 99 lines', {
      cwd: tmpDir,
      verifiers: [{
        id: 'canonical-readme',
        kind: 'file_lines',
        match: { kinds: ['file_lines'], paths: ['fake/README.md'] },
        path: 'README.md',
      }],
    });
    assert.equal(result.verified, false);
    assert.equal(result.checks[0].actual, 3);
    assert.equal(result.checks[0].path, 'README.md');
    assert.equal(result.checks[0].claimedPath, 'fake/README.md');
  });

  it('does not bind a configured basename to a different claimed path', () => {
    const result = evaluateUniversalClaims('file fake/README.md has 99 lines', {
      cwd: tmpDir,
      verifiers: verifiers(),
    });
    assert.equal(result.verified, false);
    assert.equal(result.checks[0].status, 'unconfigured');
  });

  it('fails closed on malformed verifier configuration', () => {
    const configPath = path.join(tmpDir, 'bad-verifiers.json');
    fs.writeFileSync(configPath, '{not-json');
    assert.throws(
      () => evaluateUniversalClaims('the row count is 3', { cwd: tmpDir, configPath }),
      /invalid claim verifier config/,
    );
  });

  it('fails closed when an explicitly selected config does not exist', () => {
    assert.throws(
      () => evaluateUniversalClaims('the row count is 3', {
        cwd: tmpDir,
        configPath: path.join(tmpDir, 'missing-verifiers.json'),
      }),
      /claim verifier config not found/,
    );
  });

  it('exits non-zero for an actual database mismatch through the portable CLI', () => {
    let stdout = '';
    let stderr = '';
    const configPath = path.join(tmpDir, 'claim-verifiers.json');
    fs.writeFileSync(configPath, JSON.stringify({ verifiers: verifiers() }));
    const status = runCli([
      '--claim', 'the row count is 1,284',
      '--cwd', tmpDir,
      '--config', configPath,
      '--json',
    ], {
      stdout: { write: (value) => { stdout += value; } },
      stderr: { write: (value) => { stderr += value; } },
    });
    assert.equal(status, 1);
    assert.equal(stderr, '');
    assert.equal(JSON.parse(stdout).verified, false);
  });

  it('dispatches verify-claims through the published CLI entrypoint', () => {
    const configPath = path.join(tmpDir, 'claim-verifiers.json');
    fs.writeFileSync(configPath, JSON.stringify({ verifiers: verifiers() }));
    const result = spawnSync(process.execPath, [
      path.join(__dirname, '..', 'bin', 'cli.js'),
      'verify-claims',
      '--claim=the row count is 1,284',
      `--cwd=${tmpDir}`,
      `--config=${configPath}`,
      '--json',
    ], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.verified, false);
    assert.equal(report.checks[0].status, 'mismatch');
    assert.equal(report.checks[0].actual, 3);
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

describe('loadVerifierConfig package-root defaults', () => {
  it('loads shipped package defaults when consumer cwd has no claim-verifiers.json', () => {
    const consumerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-claim-consumer-'));
    try {
      // Simulate npm install consumer project: empty cwd, no local config.
      fs.writeFileSync(path.join(consumerRoot, 'package.json'), JSON.stringify({
        name: 'consumer',
        version: '2.3.4',
      }));
      const loaded = loadVerifierConfig({ cwd: consumerRoot });
      assert.ok(loaded.verifierCount === undefined || Array.isArray(loaded.verifiers));
      assert.ok(loaded.verifiers.length >= 1, 'expected shipped default verifiers');
      assert.match(String(loaded.source), /config[\\/]gates[\\/]claim-verifiers\.json/);
      // Source should be the package install path, not the empty consumer root.
      assert.ok(!String(loaded.source).startsWith(consumerRoot));

      const result = evaluateUniversalClaims('package version is 2.3.4', {
        cwd: consumerRoot,
      });
      assert.equal(result.verified, true);
      assert.equal(result.checks[0].status, 'match');
    } finally {
      fs.rmSync(consumerRoot, { recursive: true, force: true });
    }
  });
});
