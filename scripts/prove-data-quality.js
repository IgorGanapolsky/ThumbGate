'use strict';
/**
 * Phase 7: Data Quality — Proof Gate
 *
 * Validates all QUAL-01 through QUAL-04 requirements offline.
 * Mirrors the pattern of prove-attribution.js (mkdtempSync + env override + execSync).
 *
 * Usage:
 *   node scripts/prove-data-quality.js
 *
 * Produces:
 *   proof/data-quality-report.json
 *   proof/data-quality-report.md
 */

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function resolveProofPaths() {
  const proofDir = process.env.THUMBGATE_PROOF_DIR || path.join(ROOT, 'proof');
  return {
    proofDir,
    reportJson: path.join(proofDir, 'data-quality-report.json'),
    reportMd: path.join(proofDir, 'data-quality-report.md'),
  };
}

function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-qual-proof-'));
  const results = { passed: 0, failed: 0, requirements: {} };
  const { proofDir, reportJson, reportMd } = resolveProofPaths();

  const checks = [
    {
      id: 'QUAL-01',
      desc: 'validate-feedback.js exports validateEntry with 4-level pipeline',
      fn: () => {
        delete require.cache[require.resolve('./validate-feedback')];
        const v = require('./validate-feedback');
        if (typeof v.validateEntry !== 'function') throw new Error('validateEntry not exported');
        if (typeof v.validateSchema !== 'function') throw new Error('validateSchema not exported');
        if (typeof v.validateSemantics !== 'function') throw new Error('validateSemantics not exported');
        if (typeof v.detectAnomalies !== 'function') throw new Error('detectAnomalies not exported');
        if (typeof v.generateCorrections !== 'function') throw new Error('generateCorrections not exported');

        // Verify semantic inconsistency is caught
        const r = v.validateEntry({
          id: 'proof-x',
          timestamp: new Date().toISOString(),
          signal: 'positive',
          reward: -1,
          context: 'good work done',
        });
        if (r.valid) throw new Error('Expected invalid for positive+negative-reward');
        if (!r.corrections.length) throw new Error('Expected auto-correction for reward');
        if (r.correctedEntry.reward !== 1) throw new Error('Expected corrected reward=1');

        // Verify sensitive data detection
        const r2 = v.validateEntry({
          id: 'proof-y',
          timestamp: new Date().toISOString(),
          signal: 'positive',
          reward: 1,
          context: 'api_key=abc123 was in the response',
        });
        if (!r2.issues.some((i) => i.type === 'security')) {
          throw new Error('Expected security issue for api_key pattern');
        }
      },
    },
    {
      id: 'QUAL-02',
      desc: 'captureFeedback produces richContext with domain, filePaths, errorType, outcomeCategory',
      fn: () => {
        process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
        // Clear module cache so env var takes effect
        [
          './feedback-loop',
          './feedback-attribution',
          './rlaif-self-audit',
        ].forEach((m) => {
          try {
            delete require.cache[require.resolve(m)];
          } catch {
            // optional module
          }
        });
        const { captureFeedback } = require('./feedback-loop');
        const r = captureFeedback({
          signal: 'positive',
          context: 'unit tests added for edge cases',
          tags: ['testing'],
          filePaths: ['src/api.js'],
        });
        if (!r.feedbackEvent) throw new Error('No feedbackEvent in result');
        const rc = r.feedbackEvent.richContext;
        if (!rc) throw new Error('richContext missing from feedbackEvent');
        if (typeof rc.domain !== 'string') throw new Error('richContext.domain must be string');
        if (!Array.isArray(rc.filePaths)) throw new Error('richContext.filePaths must be array');
        if (!('errorType' in rc)) throw new Error('richContext.errorType field missing');
        if (typeof rc.outcomeCategory !== 'string') throw new Error('richContext.outcomeCategory must be string');
        if (rc.domain !== 'testing') throw new Error(`Expected domain=testing, got ${rc.domain}`);
      },
    },
    {
      id: 'QUAL-03',
      desc: 'inferOutcome returns granular categories beyond binary up/down',
      fn: () => {
        [
          './feedback-loop',
        ].forEach((m) => {
          try { delete require.cache[require.resolve(m)]; } catch {}
        });
        const { inferOutcome } = require('./feedback-loop');
        if (typeof inferOutcome !== 'function') throw new Error('inferOutcome not exported from feedback-loop');

        const cases = [
          ['positive', 'solved it first try', 'quick-success'],
          ['positive', 'thorough comprehensive analysis', 'deep-success'],
          ['positive', 'worked well overall', 'standard-success'],
          ['negative', 'gave wrong incorrect answer', 'factual-error'],
          ['negative', 'shallow surface level response', 'insufficient-depth'],
          ['negative', 'guessed without checking docs', 'false-assumption'],
        ];

        for (const [signal, context, expected] of cases) {
          const got = inferOutcome(signal, context);
          if (got !== expected) {
            throw new Error(`inferOutcome('${signal}', '${context}') = '${got}', expected '${expected}'`);
          }
        }
      },
    },
    {
      id: 'QUAL-04',
      desc: 'test:quality (node --test tests/validate-feedback.test.js) passes with 0 failures',
      fn: () => {
        const out = execSync('node --test tests/validate-feedback.test.js', {
          cwd: ROOT,
          env: { ...process.env, THUMBGATE_FEEDBACK_DIR: tmpDir },
          encoding: 'utf8',
          stdio: 'pipe',
        });
        // node:test exits non-zero on failure — if we get here, all tests passed
        const failMatch = out.match(/ℹ fail (\d+)/);
        if (failMatch && parseInt(failMatch[1], 10) > 0) {
          throw new Error(`Tests failed: ${failMatch[1]} failure(s)\n${out.slice(-500)}`);
        }
      },
    },
  ];

  console.log('Phase 7: Data Quality — Proof Gate\n');
  console.log('Checking requirements:\n');

  for (const check of checks) {
    try {
      check.fn();
      results.passed++;
      results.requirements[check.id] = { status: 'pass', desc: check.desc };
      console.log(`  PASS  ${check.id}: ${check.desc}`);
    } catch (err) {
      results.failed++;
      results.requirements[check.id] = {
        status: 'fail',
        desc: check.desc,
        error: err.message,
      };
      console.error(`  FAIL  ${check.id}: ${err.message}`);
    }
  }

  // Cleanup tmp dir
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
  delete process.env.THUMBGATE_FEEDBACK_DIR;

  // Write proof artifacts
  fs.mkdirSync(proofDir, { recursive: true });

  const report = {
    phase: '07-data-quality',
    generatedAt: new Date().toISOString(),
    passed: results.passed,
    failed: results.failed,
    total: checks.length,
    requirements: results.requirements,
  };

  fs.writeFileSync(reportJson, JSON.stringify(report, null, 2) + '\n');

  const md = [
    '# Phase 7: Data Quality — Proof Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Result: ${results.passed}/${checks.length} passed`,
    '',
    '## Requirements',
    '',
    ...Object.entries(results.requirements).map(([id, r]) => {
      const checkbox = r.status === 'pass' ? '[x]' : '[ ]';
      const errLine = r.error ? `\n  - Error: \`${r.error}\`` : '';
      return `- ${checkbox} **${id}**: ${r.desc}${errLine}`;
    }),
    '',
    '## Evidence',
    '',
    '- `scripts/validate-feedback.js` — 4-level validation pipeline (schema, semantics, anomaly, self-correction)',
    '- `scripts/feedback-loop.js` — `inferOutcome()` and `enrichFeedbackContext()` added; `richContext` in every feedbackEvent',
    '- `tests/validate-feedback.test.js` — 25 node:test cases covering all QUAL requirements',
    '',
  ].join('\n');

  fs.writeFileSync(reportMd, md);

  console.log(`\nPhase 7 proof: ${results.passed} passed, ${results.failed} failed`);
  console.log(`Report: ${reportJson}`);

  if (results.failed > 0) process.exit(1);
}

run();
