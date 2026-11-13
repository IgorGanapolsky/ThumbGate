'use strict';

/**
 * Free Hagerty-Style Agent Safety & Reliability Index Scanner
 *
 * Adopted from David Meerman Scott (The Fandom Playbook - Core Mindset Shift):
 * - Stop leading with product pitches. Give away high-value valuation / diagnostic
 *   data that the target audience cares about for free.
 * - Hagerty gave away classic car valuation data and built an empire; ThumbGate
 *   gives away free agentic harness safety audits and vulnerability scoring.
 */

const fs = require('node:fs');
const path = require('node:path');
const { auditSqlForScatterQueries } = require('./load-shedding-diode');

/**
 * Scans a directory or project repository for agentic SDLC vulnerabilities.
 * @param {string} rootDir
 * @param {object} options
 */
function scanAgentSafetyIndex(rootDir = process.cwd(), options = {}) {
  const findings = [];
  let scoreDeductions = 0;

  // 1. Audit for secrets and credentials in git status or repo files
  const secretPatterns = [
    { name: 'Unencrypted .env file committed or present', regex: /^\.env(\.local|\.production)?$/i, penalty: 25 },
    { name: 'Hardcoded API tokens in tracked files', pattern: /(sk-ant-|ghp_[a-zA-Z0-9]{36}|sk-proj-)/, penalty: 30 },
  ];

  const envPath = path.join(rootDir, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const envContent = fs.readFileSync(envPath, 'utf8');
      if (envContent.includes('sk-') || envContent.includes('key') || envContent.includes('SECRET')) {
        findings.push({
          category: 'Credential Confinement',
          severity: 'HIGH',
          title: 'Unconfined .env secrets accessible to LLM context',
          detail: '.env contains API tokens without a pre-action confinement diode.',
          remediation: 'Use ThumbGate credential isolation (withoutProviderCredentials) or environment diode.',
        });
        scoreDeductions += 20;
      }
    } catch {
      // Ignored
    }
  }

  // 2. Check for CI explosion risk (missing lazy PR / concurrency cancel)
  const githubWorkflowsDir = path.join(rootDir, '.github', 'workflows');
  let hasConcurrencyControl = false;
  if (fs.existsSync(githubWorkflowsDir)) {
    try {
      const files = fs.readdirSync(githubWorkflowsDir);
      for (const file of files) {
        if (file.endsWith('.yml') || file.endsWith('.yaml')) {
          const content = fs.readFileSync(path.join(githubWorkflowsDir, file), 'utf8');
          if (content.includes('concurrency:') && content.includes('cancel-in-progress: true')) {
            hasConcurrencyControl = true;
            break;
          }
        }
      }
    } catch {
      // Ignored
    }
  }

  if (!hasConcurrencyControl) {
    findings.push({
      category: 'CI Tsunami Defense',
      severity: 'MEDIUM',
      title: 'Missing in-flight CI cancellation on multi-agent commits',
      detail: 'GitHub Actions workflows do not specify concurrency with cancel-in-progress: true. Rapid agent micro-commits will burn CI budgets.',
      remediation: 'Enable Lazy PR cancellation or add concurrency: { group: "${{ github.workflow }}-${{ github.ref }}", cancel-in-progress: true }.',
    });
    scoreDeductions += 15;
  }

  // 3. Check for unit test coverage and tautological test risk
  const testsDir = path.join(rootDir, 'tests');
  const testDirAlt = path.join(rootDir, 'test');
  const hasTests = fs.existsSync(testsDir) || fs.existsSync(testDirAlt);

  if (!hasTests) {
    findings.push({
      category: 'Test Hardening',
      severity: 'CRITICAL',
      title: 'No automated test suite discovered',
      detail: 'Autonomous agents can mutate source code without any mechanical verification barrier.',
      remediation: 'Establish node:test or Jest suite and enforce thumbgate run --verify "npm test".',
    });
    scoreDeductions += 35;
  } else {
    // Check if mutation testing is enabled
    const packageJsonPath = path.join(rootDir, 'package.json');
    let hasMutationCheck = false;
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        if (pkg.scripts && (pkg.scripts['test:mutation'] || pkg.scripts['mutation'] || pkg.scripts['verify:isolated'])) {
          hasMutationCheck = true;
        }
      } catch {
        // Ignored
      }
    }
    if (!hasMutationCheck) {
      findings.push({
        category: 'Mutation Hardening',
        severity: 'LOW',
        title: 'No mutation testing diode configured',
        detail: 'AI-generated unit tests may be circular/tautological, asserting only that current code runs rather than catching regressions.',
        remediation: 'Add scripts/mutation-test-diode.js or run thumbgate scan --mutation to verify test mutants are killed.',
      });
      scoreDeductions += 10;
    }
  }

  // 4. Check for un-sharded database queries in SQL or ORM files
  if (options.sampleSql) {
    const audit = auditSqlForScatterQueries(options.sampleSql);
    if (audit.isScatterQuery) {
      findings.push({
        category: 'Database Resilience',
        severity: 'HIGH',
        title: 'Scatter query detected in database tier',
        detail: audit.reason,
        remediation: 'Add mandatory workspace_id or tenant_id sharding key in WHERE clause.',
      });
      scoreDeductions += 20;
    }
  }

  const finalScore = Math.max(0, 100 - scoreDeductions);
  let maturityLevel = 'Level 1: Vulnerable to Agentic Regressions';
  if (finalScore >= 85) {
    maturityLevel = 'Level 3: Hardened Enterprise Agentic Fleet';
  } else if (finalScore >= 60) {
    maturityLevel = 'Level 2: Guarded with Minor Gaps';
  }

  return {
    timestamp: new Date().toISOString(),
    rootDir,
    safetyScore: finalScore,
    maturityLevel,
    isHardened: finalScore >= 80,
    findingsCount: findings.length,
    findings,
    recommendationsSummary: findings.map(f => `[${f.severity}] ${f.category}: ${f.remediation}`),
  };
}

module.exports = {
  scanAgentSafetyIndex,
};
