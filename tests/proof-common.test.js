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
  getGateTemplate,
  proveAdapterFilesExist,
  proveWorkloadRegistered,
  proveGateTemplateContractItem,
  proveGateTemplateFields,
  proveContentReferences,
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

  describe('getGateTemplate', () => {
    it('returns a template for a known id', () => {
      const template = getGateTemplate('block-vlt-install-vulnerable-deps');
      assert.ok(template, 'should find template');
      assert.strictEqual(template.id, 'block-vlt-install-vulnerable-deps');
    });

    it('returns undefined for an unknown id', () => {
      const template = getGateTemplate('nonexistent-template-id');
      assert.strictEqual(template, undefined);
    });
  });

  describe('proveAdapterFilesExist', () => {
    const root = require('path').join(__dirname, '..');
    const version = JSON.parse(require('fs').readFileSync(require('path').join(root, 'package.json'), 'utf-8')).version;

    it('validates adapter file existence and version pins', () => {
      const results = proveAdapterFilesExist(root, version, [
        { file: 'adapters/vlt/VLT.md' },
      ]);
      assert.ok(results.length >= 1, 'should have at least one result');
      assert.ok(results[0].passed, 'file should exist and pin version');
    });

    it('runs extraChecks when provided', () => {
      const results = proveAdapterFilesExist(root, version, [
        {
          file: 'adapters/vlt/opencode.json',
          extraChecks: (filePath) => {
            const json = JSON.parse(require('fs').readFileSync(filePath, 'utf-8'));
            assert.ok(json.mcp?.thumbgate, 'should have thumbgate MCP');
            return [{ name: 'extra check passed', passed: true }];
          },
        },
      ]);
      const extra = results.find((r) => r.name === 'extra check passed');
      assert.ok(extra && extra.passed, 'extra checks should pass');
    });
  });

  describe('proveWorkloadRegistered', () => {
    it('validates a known workload with candidates', () => {
      const results = proveWorkloadRegistered(
        'js-package-registry-governance',
        ['vlt/vlt-registry-hosted', 'vlt/vlt-vsr-self-hosted'],
        'vlt',
        2,
        'vlt/vlt-registry-hosted'
      );
      assert.ok(results.length >= 2, 'should have at least 2 results');
      assert.ok(results.every((r) => r.passed), 'all results should pass');
    });

    it('validates the context-engineering workload', () => {
      const results = proveWorkloadRegistered(
        'context-engineering',
        ['huggingface/context-engineering-agent'],
        'huggingface',
        1,
        'huggingface/context-engineering-agent'
      );
      assert.ok(results.every((r) => r.passed), 'all results should pass');
    });
  });

  describe('proveGateTemplateContractItem', () => {
    it('validates a vlt gate template', () => {
      const result = proveGateTemplateContractItem('block-vlt-install-vulnerable-deps', {
        expectedCategory: 'JavaScript Package Registry Governance',
      });
      assert.ok(result.passed, 'template should satisfy contract');
    });

    it('validates a context-engineering gate template', () => {
      const result = proveGateTemplateContractItem('validate-context-before-codegen', {
        expectedCategory: 'AI Engineering Stack Safety',
      });
      assert.ok(result.passed, 'template should satisfy contract');
    });
  });

  describe('proveGateTemplateFields', () => {
    it('returns a result per required field', () => {
      const fields = ['id', 'name', 'category', 'pattern'];
      const results = proveGateTemplateFields('validate-context-before-codegen', fields);
      assert.strictEqual(results.length, 4);
      assert.ok(results.every((r) => r.passed));
    });
  });

  describe('proveContentReferences', () => {
    it('validates that content contains required references', () => {
      const content = 'Hello https://example.com and validate-context-before-codegen';
      const results = proveContentReferences(content, [
        { needle: 'https://example.com', label: 'example URL' },
        { needle: 'validate-context-before-codegen', label: 'gate template' },
      ]);
      assert.strictEqual(results.length, 2);
      assert.ok(results.every((r) => r.passed));
    });

    it('throws when a reference is missing', () => {
      const content = 'some content without the needle';
      assert.throws(
        () => proveContentReferences(content, [{ needle: 'missing-needle', label: 'missing' }]),
        /guide must reference missing/
      );
    });
  });
});

// Import at end to avoid issues with the describe block
const { listGateTemplates } = require('../scripts/gate-templates');
const { loadCatalog, recommendCandidates } = require('../scripts/model-candidates');
