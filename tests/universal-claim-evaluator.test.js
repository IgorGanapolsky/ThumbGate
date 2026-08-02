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
  assertSelectOnly,
  resolveSafePath,
  pathMatches,
  compileConfiguredClaimTemplate,
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

  it('parses arbitrary operator-configured quantitative wording', () => {
    const claims = parseFactualClaims('The nightly batch built 17 invoices.', {
      verifiers: [{
        id: 'nightly-invoices',
        kind: 'json_path',
        claimTemplate: 'The nightly batch built {{value}} invoices',
      }],
    });
    assert.equal(claims.length, 1);
    assert.equal(claims[0].kind, 'configured_value');
    assert.equal(claims[0].expected, 17);
    assert.equal(claims[0].verifierId, 'nightly-invoices');
  });

  it('parses configured claims wrapped in common prose and Markdown punctuation', () => {
    const options = {
      verifiers: [{
        id: 'nightly-invoices',
        kind: 'json_path',
        claimTemplate: 'The nightly batch built {{value}} invoices',
      }],
    };
    for (const text of [
      '**The nightly batch built 17 invoices.**',
      '"The nightly batch built 17 invoices."',
      '(The nightly batch built 17 invoices.)',
    ]) {
      const claims = parseFactualClaims(text, options);
      assert.equal(claims.length, 1, text);
      assert.equal(claims[0].expected, 17, text);
      assert.equal(claims[0].verifierId, 'nightly-invoices', text);
    }
  });

  it('does not parse a configured claim embedded inside a word', () => {
    const claims = parseFactualClaims('prefixThe nightly batch built 17 invoicessuffix', {
      verifiers: [{
        id: 'nightly-invoices',
        kind: 'json_path',
        claimTemplate: 'The nightly batch built {{value}} invoices',
      }],
    });
    assert.deepEqual(claims, []);
  });

  it('rejects unsafe or ambiguous configured templates', () => {
    assert.throws(() => compileConfiguredClaimTemplate('{{value}}'), /literal characters/);
    assert.throws(
      () => compileConfiguredClaimTemplate('built {{value}} of {{value}}'),
      /exactly one/,
    );
    assert.throws(
      () => parseFactualClaims('built 17 invoices', {
        verifiers: [
          { id: 'invoices-a', kind: 'json_path', claimTemplate: 'built {{value}} invoices' },
          { id: 'invoices-b', kind: 'json_path', claimTemplate: 'built {{value}} invoices' },
        ],
      }),
      /multiple configured verifiers/,
    );
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
    fs.writeFileSync(path.join(tmpDir, 'metrics.json'), JSON.stringify({ nightly: { invoices: 12 } }));

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
    {
      id: 'nightly-invoices',
      kind: 'json_path',
      claimTemplate: 'The nightly batch built {{value}} invoices',
      path: 'metrics.json',
      jsonPath: 'nightly.invoices',
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

  it('rechecks an arbitrary configured claim template and passes on a match', () => {
    const result = evaluateUniversalClaims('The nightly batch built 12 invoices.', {
      cwd: tmpDir,
      verifiers: verifiers(),
    });
    assert.equal(result.verified, true);
    assert.equal(result.checks[0].status, 'match');
    assert.equal(result.checks[0].actual, 12);
    assert.equal(result.checks[0].verifierId, 'nightly-invoices');
  });

  it('rechecks an arbitrary configured claim template and blocks a mismatch', () => {
    const result = evaluateUniversalClaims('The nightly batch built 17 invoices.', {
      cwd: tmpDir,
      verifiers: verifiers(),
    });
    assert.equal(result.verified, false);
    assert.equal(result.checks[0].status, 'mismatch');
    assert.equal(result.checks[0].expected, 17);
    assert.equal(result.checks[0].actual, 12);
  });

  it('binds a configured template directly even when built-in grammar also matches', () => {
    const result = evaluateUniversalClaims('the row count is 12', {
      cwd: tmpDir,
      verifiers: [
        ...verifiers(),
        {
          id: 'template-row-count',
          kind: 'json_path',
          claimTemplate: 'the row count is {{value}}',
          path: 'metrics.json',
          jsonPath: 'nightly.invoices',
        },
      ],
    });
    assert.equal(result.verified, true);
    assert.equal(result.checks.length, 1);
    assert.equal(result.checks[0].actual, 12);
    assert.equal(result.checks[0].verifierId, 'template-row-count');
  });

  it('fails closed on malformed claim-template configuration before parsing', () => {
    assert.throws(
      () => evaluateUniversalClaims('No built-in factual wording here.', {
        cwd: tmpDir,
        verifiers: [{
          id: 'invalid-template',
          kind: 'json_path',
          claimTemplate: 'The nightly batch built invoices',
          path: 'metrics.json',
          jsonPath: 'nightly.invoices',
        }],
      }),
      /exactly one/,
    );
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

  it('blocks MCP-style verification for an arbitrary configured claim template', () => {
    clearSessionActions();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-claim-template-int-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'metrics.json'), JSON.stringify({ nightly: { invoices: 12 } }));
      const result = verifyClaimEvidence('The nightly batch built 17 invoices.', {
        cwd: tmpDir,
        verifiers: [{
          id: 'nightly-invoices',
          kind: 'json_path',
          claimTemplate: 'The nightly batch built {{value}} invoices',
          path: 'metrics.json',
          jsonPath: 'nightly.invoices',
        }],
      });
      assert.equal(result.verified, false);
      assert.equal(result.universal.checks[0].universal.status, 'mismatch');
      assert.equal(result.universal.checks[0].universal.actual, 12);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      clearSessionActions();
    }
  });
});
