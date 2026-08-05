'use strict';

/**
 * Shared utilities for proof harness scripts.
 *
 * Extracted from prove-vlt.js and prove-hf-context.js to eliminate
 * code duplication flagged by SonarCloud quality gate.
 *
 * Exports:
 *   - check: assertion utility
 *   - ensureDir: directory creation
 *   - patternMatches: regex testing
 *   - runProofSuites: core test runner
 *   - createProofRunner: factory for proof entry points
 *   - printReportAndExit: CLI exit handler
 */

const fs = require('fs');
const path = require('path');

/**
 * Throws if condition is falsy.
 * @param {*} condition - The condition to check.
 * @param {string} message - Error message if condition fails.
 */
function check(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Recursively creates a directory if it doesn't exist.
 * @param {string} dirPath - Path to create.
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Tests that a regex pattern matches the expected input.
 * @param {string} pattern - The regex pattern string.
 * @param {string} input - The input string to test.
 * @returns {boolean} Whether the pattern matches the input.
 */
function patternMatches(pattern, input) {
  if (!pattern) return false;
  try {
    return new RegExp(pattern).test(input);
  } catch (e) {
    throw new Error(`Invalid regex pattern "${pattern}": ${e.message}`);
  }
}

/**
 * Runs an array of proof test suites and returns a structured report.
 * @param {Array<{name: string, fn: Function}>} suites - Test suite definitions.
 * @param {Object} options - Options object.
 * @param {string} options.proofDir - Directory for proof artifacts.
 * @param {string} options.packageVersion - The shipped package version.
 * @param {string} options.reportName - Filename for the JSON report.
 * @param {boolean} options.writeArtifacts - Whether to write artifacts (default true).
 * @returns {Object} The proof report with summary and results.
 */
function runProofSuites(suites, options = {}) {
  const {
    proofDir,
    packageVersion,
    reportName = 'proof-report.json',
    writeArtifacts = true,
  } = options;

  if (writeArtifacts) ensureDir(proofDir);

  const allResults = [];
  const summary = { total: 0, passed: 0, failed: 0, suites: {} };

  for (const suite of suites) {
    let suiteResults;
    let suitePassed = true;
    try {
      suiteResults = suite.fn();
      suitePassed = suiteResults.every((r) => r.passed);
    } catch (e) {
      suiteResults = [{ name: `${suite.name} threw`, passed: false, error: e.message }];
      suitePassed = false;
    }

    allResults.push(...suiteResults);
    summary.suites[suite.name] = {
      passed: suitePassed,
      tests: suiteResults.length,
    };
    summary.total += suiteResults.length;
    summary.passed += suiteResults.filter((r) => r.passed).length;
    summary.failed += suiteResults.filter((r) => !r.passed).length;
  }

  const report = {
    proofDir,
    packageVersion,
    summary,
    results: allResults,
  };

  if (writeArtifacts) {
    const reportPath = path.join(proofDir, reportName);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  }

  return report;
}

/**
 * Prints the proof report summary and exits with appropriate code.
 * @param {Object} report - The proof report from runProofSuites.
 * @param {string} successLabel - Label for the success message.
 */
function printReportAndExit(report, successLabel) {
  console.log(JSON.stringify(report.summary, null, 2));
  if (report.summary.failed > 0) {
    console.error(`\n${report.summary.failed} test(s) failed:`);
    for (const result of report.results) {
      if (!result.passed) {
        console.error(`  ✗ ${result.name}`);
        if (result.error) console.error(`    ${result.error}`);
      }
    }
    process.exit(1);
  }
  console.log(`\nAll ${report.summary.total} ${successLabel} proof tests passed.`);
}

/**
 * Factory that creates a proof runner for a specific domain.
 * @param {Object} config - Configuration for the proof runner.
 * @param {string} config.envVar - Environment variable for proof directory.
 * @param {string} config.defaultProofDir - Default proof directory.
 * @param {string} config.reportName - JSON report filename.
 * @param {string} config.successLabel - Label for success message.
 * @param {string} config.packageVersion - The shipped package version.
 * @param {Function} config.buildSuites - Function that returns the suite array.
 * @returns {Function} A runProof function.
 */
function createProofRunner(config) {
  const {
    envVar,
    defaultProofDir,
    reportName,
    successLabel,
    packageVersion,
    buildSuites,
  } = config;

  function runProof(options = {}) {
    const proofDir = options.proofDir || process.env[envVar] || defaultProofDir;
    return runProofSuites(buildSuites(), {
      proofDir,
      packageVersion,
      reportName,
      writeArtifacts: options.writeArtifacts !== false,
    });
  }

  function main() {
    const report = runProof();
    printReportAndExit(report, successLabel);
  }

  return { runProof, main };
}

module.exports = {
  check,
  ensureDir,
  patternMatches,
  runProofSuites,
  printReportAndExit,
  createProofRunner,
};
