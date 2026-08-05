'use strict';

/**
 * Tests for the shared proof harness utilities (scripts/proof-common.js).
 *
 * These tests ensure coverage of the shared module and verify that
 * createProofRunner, patternMatches, check, ensureDir, runProofSuites,
 * and printReportAndExit all behave correctly.
 */

const assert = require('node:assert');
const { describe, it } = require('node:test');

// We test printReportAndExit by intercepting process.exit and console
const originalExit = process.exit;
const originalLog = console.log;
const originalError = console.error;

const {
  check,
  ensureDir,
  patternMatches,
  runProofSuites,
  printReportAndExit,
  createProofRunner,
} = require('../scripts/proof-common');

describe('proof-common', () => {
  describe('check', () => {
    it('throws when condition is false', () => {
      assert.throws(() => check(false, 'test error'), /test error/);
    });

    it('does not throw when condition is true', () => {
      assert.doesNotThrow(() => check(true, 'should not throw'));
    });

    it('throws when condition is undefined', () => {
      assert.throws(() => check(undefined, 'undefined is falsy'), /undefined is falsy/);
    });
  });

  describe('patternMatches', () => {
    it('returns true when pattern matches input', () => {
      assert.ok(patternMatches('vlt.*install', 'vlt install lodash'));
    });

    it('returns false when pattern does not match input', () => {
      assert.ok(!patternMatches('vlt.*install', 'npm install lodash'));
    });

    it('returns false for empty pattern', () => {
      assert.ok(!patternMatches('', 'some input'));
    });

    it('returns false for undefined pattern', () => {
      assert.ok(!patternMatches(undefined, 'some input'));
    });

    it('throws for invalid regex pattern', () => {
      assert.throws(() => patternMatches('[invalid', 'input'), /Invalid regex pattern/);
    });
  });

  describe('ensureDir', () => {
    it('creates a directory that does not exist', () => {
      const testDir = require('path').join(require('os').tmpdir(), 'tg-proof-common-test-' + Date.now());
      ensureDir(testDir);
      assert.ok(require('fs').existsSync(testDir));
      // cleanup
      require('fs').rmSync(testDir, { recursive: true, force: true });
    });

    it('does not throw when directory already exists', () => {
      const testDir = require('path').join(require('os').tmpdir(), 'tg-proof-common-test-existing-' + Date.now());
      ensureDir(testDir);
      assert.doesNotThrow(() => ensureDir(testDir));
      require('fs').rmSync(testDir, { recursive: true, force: true });
    });
  });

  describe('runProofSuites', () => {
    it('returns a report with summary', () => {
      const suites = [
        {
          name: 'suite1',
          fn: () => [{ name: 'test1', passed: true }, { name: 'test2', passed: true }],
        },
      ];
      const report = runProofSuites(suites, {
        proofDir: '/tmp/test-proof',
        packageVersion: '1.0.0',
        reportName: 'test-report.json',
        writeArtifacts: false,
      });

      assert.strictEqual(report.summary.total, 2);
      assert.strictEqual(report.summary.passed, 2);
      assert.strictEqual(report.summary.failed, 0);
    });

    it('handles suite failures gracefully', () => {
      const suites = [
        {
          name: 'suite1',
          fn: () => [{ name: 'test1', passed: false }],
        },
      ];
      const report = runProofSuites(suites, {
        proofDir: '/tmp/test-proof',
        packageVersion: '1.0.0',
        writeArtifacts: false,
      });

      assert.strictEqual(report.summary.failed, 1);
      assert.strictEqual(report.summary.passed, 0);
    });

    it('catches exceptions from suite functions', () => {
      const suites = [
        {
          name: 'broken',
          fn: () => {
            throw new Error('suite error');
          },
        },
      ];
      const report = runProofSuites(suites, {
        proofDir: '/tmp/test-proof',
        packageVersion: '1.0.0',
        writeArtifacts: false,
      });

      assert.strictEqual(report.summary.failed, 1);
      assert.ok(report.results[0].error);
    });

    it('writes report file when writeArtifacts is true', () => {
      const fs = require('fs');
      const os = require('os');
      const testDir = require('path').join(os.tmpdir(), 'tg-proof-test-write-' + Date.now());
      const suites = [
        { name: 's', fn: () => [{ name: 't', passed: true }] },
      ];
      const report = runProofSuites(suites, {
        proofDir: testDir,
        packageVersion: '1.0.0',
        reportName: 'report.json',
        writeArtifacts: true,
      });
      const reportPath = require('path').join(testDir, 'report.json');
      assert.ok(fs.existsSync(reportPath));
      const parsed = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
      assert.strictEqual(parsed.summary.total, 1);
      fs.rmSync(testDir, { recursive: true, force: true });
    });
  });

  describe('createProofRunner', () => {
    it('creates a runProof function that returns a report', () => {
      const { runProof } = createProofRunner({
        envVar: 'TEST_PROOF_DIR',
        defaultProofDir: '/tmp/test-runner',
        reportName: 'test-report.json',
        successLabel: 'test',
        packageVersion: '1.0.0',
        buildSuites: () => [{ name: 's', fn: () => [{ name: 't', passed: true }] }],
      });
      const report = runProof({ writeArtifacts: false });
      assert.ok(report.summary);
      assert.strictEqual(report.summary.total, 1);
    });

    it('uses env var for proofDir when no options', () => {
      process.env.TEST_PROOF_DIR = '/tmp/test-env-dir';
      const { runProof } = createProofRunner({
        envVar: 'TEST_PROOF_DIR',
        defaultProofDir: '/tmp/test-default-dir',
        reportName: 'test-report.json',
        successLabel: 'test',
        packageVersion: '1.0.0',
        buildSuites: () => [{ name: 's', fn: () => [{ name: 't', passed: true }] }],
      });
      const report = runProof({ writeArtifacts: false });
      assert.strictEqual(report.proofDir, '/tmp/test-env-dir');
      delete process.env.TEST_PROOF_DIR;
    });

    it('falls back to defaultProofDir when env var not set', () => {
      delete process.env.NONEXISTENT_TEST_PROOF_DIR;
      const { runProof } = createProofRunner({
        envVar: 'NONEXISTENT_TEST_PROOF_DIR',
        defaultProofDir: '/tmp/test-default-dir',
        reportName: 'test-report.json',
        successLabel: 'test',
        packageVersion: '1.0.0',
        buildSuites: () => [{ name: 's', fn: () => [{ name: 't', passed: true }] }],
      });
      const report = runProof({ writeArtifacts: false });
      assert.strictEqual(report.proofDir, '/tmp/test-default-dir');
    });
  });

  describe('printReportAndExit', () => {
    it('exits with code 1 when tests fail', () => {
      let exitCode = null;
      process.exit = (code) => { exitCode = code; };
      console.log = () => {};
      console.error = () => {};
      const report = {
        summary: { total: 1, passed: 0, failed: 1, suites: {} },
        results: [{ name: 'failed-test', passed: false, error: 'boom' }],
      };
      printReportAndExit(report, 'test-label');
      assert.strictEqual(exitCode, 1);
      process.exit = originalExit;
      console.log = originalLog;
      console.error = originalError;
    });

    it('does not exit when tests pass', () => {
      let exitCode = null;
      process.exit = (code) => { exitCode = code; };
      console.log = () => {};
      console.error = () => {};
      const report = {
        summary: { total: 1, passed: 1, failed: 0, suites: {} },
        results: [{ name: 'passed-test', passed: true }],
      };
      printReportAndExit(report, 'test-label');
      assert.strictEqual(exitCode, null);
      process.exit = originalExit;
      console.log = originalLog;
      console.error = originalError;
    });
  });
});
