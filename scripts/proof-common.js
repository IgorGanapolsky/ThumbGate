'use strict';

/**
 * Shared utilities and test patterns for proof harness scripts.
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
 *   - proveAdapterFilesExist: shared adapter file validation
 *   - proveWorkloadRegistered: shared workload + candidate validation
 *   - proveGateTemplateContractForIds: shared gate template contract validation
 *   - proveGateTemplateFields: shared field-presence validation
 *   - proveContentReferences: shared content-reference validation
 */

const fs = require('fs');
const path = require('path');
const { listGateTemplates } = require('./gate-templates');
const { loadCatalog, recommendCandidates } = require('./model-candidates');

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
 * Prints the proof report summary and signals failure via a non-zero exit code.
 *
 * Uses throw rather than process.exit to allow proper cleanup and testability.
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
    const failureError = new Error(`${report.summary.failed} proof test(s) failed`);
    failureError.code = 'PROOF_FAILURE';
    throw failureError;
  }
  console.log(`\nAll ${report.summary.total} ${successLabel} proof tests passed.`);
}

/**
 * Factory that creates a proof runner for a specific domain.
 * @param {Object} config - Configuration for the proof runner.
 * @param {string} config.envVar - Environment variable for proof directory.
 * @param {string} config.defaultProofDir - Default proof directory.
 * @param {string} config.reportName - Filename for the JSON report.
 * @param {string} config.successLabel - Label for the success message.
 * @param {string} config.packageVersion - The shipped package version.
 * @param {Function} config.buildSuites - Function that returns the suite array.
 * @returns {{runProof: Function, main: Function}} The proof runner.
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
    try {
      printReportAndExit(report, successLabel);
    } catch (e) {
      if (e.code === 'PROOF_FAILURE') {
        process.exitCode = 1;
      } else {
        throw e;
      }
    }
  }

  return { runProof, main };
}

/**
 * Returns the gate template matching the given id from the config catalog.
 * @param {string} id - The template id to find.
 * @returns {Object|undefined} The matching template, or undefined.
 */
function getGateTemplate(id) {
  const templates = listGateTemplates();
  return templates.find((template) => template.id === id);
}

/**
 * Shared adapter file validation: checks existence, version pin, and JSON validity.
 * @param {string} ROOT - Project root path.
 * @param {string} PACKAGE_VERSION - The shipped package version.
 * @param {Array<{file: string, extraChecks?: Function}>} adapterFiles - File specs.
 * @returns {Array<Object>} Results array.
 */
function proveAdapterFilesExist(ROOT, PACKAGE_VERSION, adapterFiles) {
  const results = [];

  for (const { file, extraChecks } of adapterFiles) {
    const filePath = path.join(ROOT, file);
    check(fs.existsSync(filePath), `${file} must exist`);
    const content = fs.readFileSync(filePath, 'utf-8');
    check(content.includes(`thumbgate@${PACKAGE_VERSION}`), `${file} must pin thumbgate@${PACKAGE_VERSION}`);
    results.push({
      name: `${file} exists and pins thumbgate@${PACKAGE_VERSION}`,
      passed: true,
      details: { file, version: PACKAGE_VERSION },
    });

    if (extraChecks) {
      const extraResults = extraChecks(filePath, content);
      results.push(...extraResults);
    }
  }

  return results;
}

/**
 * Shared workload + candidate validation.
 * @param {string} workloadId - The workload identifier.
 * @param {Array<string>} expectedIds - Expected candidate IDs.
 * @param {string} provider - Provider name for recommendCandidates.
 * @param {number} maxCandidates - Expected number of recommendations.
 * @param {string} topCandidateId - The expected top recommendation ID.
 * @returns {Array<Object>} Results array.
 */
function proveWorkloadRegistered(workloadId, expectedIds, provider, maxCandidates, topCandidateId) {
  const results = [];

  const catalog = loadCatalog();
  const workload = catalog.workloads[workloadId];
  if (!workload) throw new Error(`${workloadId} workload must exist in catalog`);

  results.push({
    name: `${workloadId} workload exists`,
    passed: true,
    details: { metrics: workload.metrics },
  });

  const ids = new Set(catalog.candidates.map((c) => c.id));
  for (const id of expectedIds) {
    check(ids.has(id), `${id} candidate must exist`);
  }

  results.push({
    name: `${provider} model candidates registered`,
    passed: expectedIds.every((id) => ids.has(id)),
    details: { ids: expectedIds },
  });

  const report = recommendCandidates({
    workload: workloadId,
    provider,
    maxCandidates,
  });

  check(report.recommended.length >= 1, `should recommend at least 1 candidate for ${workloadId}`);
  if (topCandidateId) {
    const topCandidate = report.recommended[0];
    if (!topCandidate) throw new Error(`no top candidate returned for ${workloadId}`);
    check(topCandidate.id === topCandidateId, `top recommendation must be ${topCandidateId}`);
  }

  results.push({
    name: `recommendCandidates returns ${provider} candidate for ${workloadId}`,
    passed: topCandidateId
      ? report.recommended[0].id === topCandidateId
      : report.recommended.length >= 1,
    details: { recommended: report.recommended.map((r) => r.id) },
  });

  return results;
}

/**
 * Shared gate template contract validation.
 * @param {string} templateId - The gate template id to validate.
 * @param {Object} options - Options.
 * @param {string} options.expectedCategory - Required category.
 * @param {string} options.expectedSignal - Required signal (default '👎').
 * @param {string} options.expectedAction - Required defaultAction (default 'block').
 * @param {Array<string>} options.validSeverities - Allowed severity values.
 * @returns {Object} Single result object.
 */
function proveGateTemplateContractItem(templateId, options = {}) {
  const {
    expectedCategory,
    expectedSignal = '👎',
    expectedAction = 'block',
    validSeverities = ['critical', 'high'],
  } = options;

  const template = getGateTemplate(templateId);
  if (!template) throw new Error(`gate template ${templateId} must exist`);

  check(template.category === expectedCategory, `${templateId} must have category ${expectedCategory}`);
  check(template.signal === expectedSignal, `${templateId} must have ${expectedSignal} signal`);
  check(template.defaultAction === expectedAction, `${templateId} must default to ${expectedAction}`);
  check(validSeverities.includes(template.severity), `${templateId} must have valid severity`);
  check(template.problem && template.problem.length > 0, `${templateId} must have a problem statement`);
  check(template.roi && template.roi.length > 0, `${templateId} must have ROI statement`);
  check(template.rollout && template.rollout.length > 0, `${templateId} must have rollout guidance`);

  return {
    name: `${templateId} satisfies gate template contract`,
    passed: true,
    details: { severity: template.severity, category: template.category },
  };
}

/**
 * Validates that all required fields are present on a gate template.
 * @param {string} templateId - The gate template id.
 * @param {Array<string>} requiredFields - List of required field names.
 * @returns {Array<Object>} Results array (one per field).
 */
function proveGateTemplateFields(templateId, requiredFields) {
  const results = [];
  const template = getGateTemplate(templateId);
  if (!template) throw new Error(`gate template ${templateId} must exist`);

  for (const field of requiredFields) {
    check(template[field], `validate-context-before-codegen must have ${field}`);
    results.push({
      name: `${templateId} has ${field}`,
      passed: true,
    });
  }

  return results;
}

/**
 * Checks that a content string contains all required references.
 * @param {string} content - The file content to check.
 * @param {Array<{needle: string, label: string}>} requiredRefs - References to find.
 * @returns {Array<Object>} Results array.
 */
function proveContentReferences(content, requiredRefs) {
  const results = [];

  for (const { needle, label } of requiredRefs) {
    const found = content.includes(needle);
    results.push({
      name: `guide references ${label}`,
      passed: found,
      details: { needle, found },
    });
    if (!found) {
      throw new Error(`guide must reference ${label}: "${needle}"`);
    }
  }

  return results;
}

module.exports = {
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
};
