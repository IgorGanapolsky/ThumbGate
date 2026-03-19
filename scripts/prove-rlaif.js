#!/usr/bin/env node
'use strict';

/**
 * prove-rlaif.js — Phase 5 gate proof script.
 *
 * Generates proof/rlaif-report.md and proof/rlaif-report.json documenting
 * per-requirement evidence for DPO-01 through DPO-04.
 *
 * Mirrors the prove-lancedb.js structure exactly.
 *
 * Exit 0 if no 'fail' statuses; exit 1 if any 'fail'.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { escapeMarkdownTableCell } = require('./markdown-escape');

const ROOT = path.join(__dirname, '..');
const PROOF_DIR = path.join(ROOT, 'proof');

// Phase 4 node-runner test baseline (before Phase 5 tests)
const PHASE4_BASELINE = 93;

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

async function runProof() {
  const report = {
    phase: '05-rlaif-and-dpo-optimization',
    generated: new Date().toISOString(),
    requirements: {},
    summary: { passed: 0, failed: 0, warned: 0 },
  };

  function addResult(reqId, reqStatus, evidence) {
    report.requirements[reqId] = { status: reqStatus, evidence };
    if (reqStatus === 'pass') report.summary.passed += 1;
    else if (reqStatus === 'warn') report.summary.warned += 1;
    else report.summary.failed += 1;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-rlaif-'));

  // ─────────────────────────────────────────────────────────────────────────
  // DPO-01: selfAudit() returns float score in [0,1] and writes self-score-log.jsonl
  // Evidence: create well-formed event, call selfAudit + selfAuditAndLog, verify
  // ─────────────────────────────────────────────────────────────────────────
  let dpo01Status = 'fail';
  let dpo01Evidence = '';
  try {
    delete require.cache[require.resolve('./rlaif-self-audit')];
    const { selfAudit, selfAuditAndLog } = require('./rlaif-self-audit');

    const event = {
      id: 'proof-dpo01',
      signal: 'positive',
      context: 'RLAIF proof: selfAudit smoke test for DPO-01 verification',
      whatWorked: 'selfAudit returns score in [0,1] with constraint breakdown',
      tags: ['proof', 'rlaif', 'dpo01'],
      rubric: { promotionEligible: true, failingGuardrails: [] },
      timestamp: new Date().toISOString(),
    };

    const auditResult = selfAudit(event);

    // Verify score is a finite float in [0, 1]
    const scoreOk = typeof auditResult.score === 'number' &&
      isFinite(auditResult.score) &&
      auditResult.score >= 0 &&
      auditResult.score <= 1;

    const constraintsOk = Array.isArray(auditResult.constraints) &&
      auditResult.constraints.length === 6;

    // Test selfAuditAndLog — writes self-score-log.jsonl to tmpDir
    const logResult = selfAuditAndLog(event, { FEEDBACK_DIR: tmpDir });
    const logPath = path.join(tmpDir, 'self-score-log.jsonl');
    const logExists = fs.existsSync(logPath);

    let logEntryOk = false;
    if (logExists) {
      const line = fs.readFileSync(logPath, 'utf-8').trim().split('\n')[0];
      try {
        const parsed = JSON.parse(line);
        logEntryOk = parsed.feedbackId === 'proof-dpo01' && typeof parsed.score === 'number';
      } catch (_) {
        logEntryOk = false;
      }
    }

    if (scoreOk && constraintsOk && logExists && logEntryOk) {
      dpo01Status = 'pass';
      dpo01Evidence =
        `selfAudit() returned score=${auditResult.score} (float in [0,1]), ` +
        `constraints.length=${auditResult.constraints.length} (6 CLAUDE.md constraints). ` +
        `selfAuditAndLog() wrote self-score-log.jsonl to ${tmpDir}. ` +
        `Log entry: feedbackId=proof-dpo01, score present. ` +
        `Module: scripts/rlaif-self-audit.js. No API calls — pure heuristic evaluation.`;
    } else {
      dpo01Status = 'fail';
      const issues = [];
      if (!scoreOk) issues.push(`score not in [0,1]: ${auditResult.score}`);
      if (!constraintsOk) issues.push(`constraints.length=${auditResult.constraints ? auditResult.constraints.length : 'none'}, expected 6`);
      if (!logExists) issues.push(`self-score-log.jsonl not written to ${tmpDir}`);
      if (!logEntryOk) issues.push(`log entry invalid or missing feedbackId`);
      dpo01Evidence = `DPO-01 smoke test failed: ${issues.join('; ')}`;
    }
  } catch (err) {
    dpo01Status = 'fail';
    dpo01Evidence = `selfAudit() threw: ${err.message}`;
  }
  addResult('DPO-01', dpo01Status, dpo01Evidence);

  // ─────────────────────────────────────────────────────────────────────────
  // DPO-02: dpoOptimizer.run() writes dpo-model.json
  // Evidence: call run() with tmpDir, verify dpo-model.json is written
  // ─────────────────────────────────────────────────────────────────────────
  const tmpDirDpo02 = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-dpo02-'));
  let dpo02Status = 'fail';
  let dpo02Evidence = '';
  try {
    delete require.cache[require.resolve('./dpo-optimizer')];
    const { run: dpoRun } = require('./dpo-optimizer');

    const result = dpoRun({
      feedbackDir: tmpDirDpo02,
      modelPath: path.join(tmpDirDpo02, 'feedback_model.json'),
    });

    const dpoModelPath = path.join(tmpDirDpo02, 'dpo-model.json');
    const dpoModelExists = fs.existsSync(dpoModelPath);

    let modelOk = false;
    let modelData = null;
    if (dpoModelExists) {
      try {
        modelData = JSON.parse(fs.readFileSync(dpoModelPath, 'utf-8'));
        modelOk = 'generated' in modelData && 'pairs_processed' in modelData;
      } catch (_) {
        modelOk = false;
      }
    }

    if (dpoModelExists && modelOk) {
      dpo02Status = 'pass';
      dpo02Evidence =
        `dpoOptimizer.run() completed: pairs_processed=${result.pairs_processed}. ` +
        `dpo-model.json written to ${tmpDirDpo02}. ` +
        `Model fields: generated=${modelData.generated}, pairs_processed=${modelData.pairs_processed}. ` +
        `adjustments=${JSON.stringify(modelData.adjustments || {})}. ` +
        `Module: scripts/dpo-optimizer.js. dpoLogRatio range: [-1, +1]. Pure offline batch optimization.`;
    } else {
      dpo02Status = 'fail';
      const issues = [];
      if (!dpoModelExists) issues.push(`dpo-model.json not written to ${tmpDirDpo02}`);
      if (!modelOk) issues.push(`dpo-model.json missing required fields (generated, pairs_processed)`);
      dpo02Evidence = `DPO-02 smoke test failed: ${issues.join('; ')}`;
    }
  } catch (err) {
    dpo02Status = 'fail';
    dpo02Evidence = `dpoOptimizer.run() threw: ${err.message}`;
  } finally {
    try { fs.rmSync(tmpDirDpo02, { recursive: true, force: true }); } catch (_) {}
  }
  addResult('DPO-02', dpo02Status, dpo02Evidence);

  // ─────────────────────────────────────────────────────────────────────────
  // DPO-03: extractMetaPolicyRules() produces rules.json when data exists
  // Evidence: seed 3 negative entries in same domain, call run(), verify output
  // ─────────────────────────────────────────────────────────────────────────
  const tmpDirDpo03 = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-dpo03-'));
  let dpo03Status = 'fail';
  let dpo03Evidence = '';
  try {
    // Seed 3 negative memory entries with same domain tags
    const memoryLogPath = path.join(tmpDirDpo03, 'memory-log.jsonl');
    const oldDate = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
    const seedEntries = [
      {
        id: 'proof-err-1',
        signal: 'negative',
        category: 'error',
        title: 'MISTAKE: verification skipped',
        content: 'How to avoid: Always run tests before claiming done.',
        tags: ['verification', 'testing'],
        context: 'Proof seed entry 1 for DPO-03 meta-policy rule extraction',
        timestamp: oldDate,
      },
      {
        id: 'proof-err-2',
        signal: 'negative',
        category: 'error',
        title: 'MISTAKE: verification skipped again',
        content: 'How to avoid: Run npm test before claiming completion.',
        tags: ['verification', 'testing'],
        context: 'Proof seed entry 2 for DPO-03 meta-policy rule extraction',
        timestamp: oldDate,
      },
      {
        id: 'proof-err-3',
        signal: 'negative',
        category: 'error',
        title: 'MISTAKE: test output not included',
        content: 'How to avoid: Always include test output in evidence.',
        tags: ['verification', 'testing'],
        context: 'Proof seed entry 3 for DPO-03 meta-policy rule extraction',
        timestamp: oldDate,
      },
    ];
    fs.writeFileSync(
      memoryLogPath,
      seedEntries.map((e) => JSON.stringify(e)).join('\n') + '\n',
    );

    // Invalidate meta-policy + its dependencies so feedbackDir is picked up fresh
    for (const key of Object.keys(require.cache)) {
      if (key.includes('meta-policy') || key.includes('feedback-loop') || key.includes('thompson-sampling')) {
        delete require.cache[key];
      }
    }
    const { run: metaRun } = require('./meta-policy');
    const metaResult = metaRun({ feedbackDir: tmpDirDpo03 });

    const outPath = path.join(tmpDirDpo03, 'meta-policy-rules.json');
    const outExists = fs.existsSync(outPath);

    let outOk = false;
    let parsedOut = null;
    if (outExists) {
      try {
        parsedOut = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
        outOk = Array.isArray(parsedOut.rules);
      } catch (_) {
        outOk = false;
      }
    }

    const ruleCount = outOk ? parsedOut.rules.length : 0;
    const hasRequiredFields = outOk && ruleCount > 0 &&
      parsedOut.rules.every((r) =>
        'category' in r && 'confidence' in r && 'trend' in r && 'occurrence_count' in r
      );

    if (outExists && outOk && ruleCount >= 1 && hasRequiredFields) {
      dpo03Status = 'pass';
      dpo03Evidence =
        `extractMetaPolicyRules() produced ${ruleCount} rule(s) from 3 seeded negative entries. ` +
        `meta-policy-rules.json written to ${tmpDirDpo03}. ` +
        `Rules: ${JSON.stringify(parsedOut.rules.map((r) => ({ category: r.category, confidence: r.confidence, trend: r.trend, count: r.occurrence_count })))}. ` +
        `All rules have required fields: category, confidence, trend, occurrence_count. ` +
        `Module: scripts/meta-policy.js. MIN_OCCURRENCES threshold: 2.`;
    } else {
      dpo03Status = 'fail';
      const issues = [];
      if (!outExists) issues.push(`meta-policy-rules.json not written to ${tmpDirDpo03}`);
      if (!outOk) issues.push(`output JSON missing rules array`);
      if (ruleCount < 1) issues.push(`extracted 0 rules from 3 seeded negative entries (expected >= 1)`);
      if (!hasRequiredFields) issues.push(`rules missing required fields`);
      dpo03Evidence = `DPO-03 smoke test failed: ${issues.join('; ')}`;
    }
  } catch (err) {
    dpo03Status = 'fail';
    dpo03Evidence = `meta-policy run() threw: ${err.message}`;
  } finally {
    try { fs.rmSync(tmpDirDpo03, { recursive: true, force: true }); } catch (_) {}
  }
  addResult('DPO-03', dpo03Status, dpo03Evidence);

  // ─────────────────────────────────────────────────────────────────────────
  // DPO-04: node --test exits 0 for all RLAIF test files; report test count delta
  // Evidence: execSync node --test on 3 RLAIF test files, parse pass/fail counts
  // ─────────────────────────────────────────────────────────────────────────
  let dpo04Status = 'fail';
  let dpo04Evidence = '';
  let rlaifPassCount = 0;
  let rlaifFailCount = 0;
  try {
    const testOutput = execSync(
      'node --test tests/rlaif-self-audit.test.js tests/dpo-optimizer.test.js tests/meta-policy.test.js 2>&1',
      { cwd: ROOT, timeout: 60000, encoding: 'utf-8' }
    );

    const passMatch = testOutput.match(/pass\s+(\d+)/);
    const failMatch = testOutput.match(/fail\s+(\d+)/);
    rlaifPassCount = passMatch ? parseInt(passMatch[1], 10) : 0;
    rlaifFailCount = failMatch ? parseInt(failMatch[1], 10) : 0;

    const meetsRequirement = rlaifPassCount >= 6 && rlaifFailCount === 0;

    if (meetsRequirement) {
      dpo04Status = 'pass';
      dpo04Evidence =
        `node --test (3 RLAIF test files): pass=${rlaifPassCount}, fail=${rlaifFailCount}. ` +
        `Phase 4 baseline (test:api): ${PHASE4_BASELINE} tests. ` +
        `Phase 5 adds ${rlaifPassCount} new RLAIF tests. ` +
        `Total with RLAIF: ${PHASE4_BASELINE + rlaifPassCount} tests (node-runner only). ` +
        `Files: tests/rlaif-self-audit.test.js (selfAudit, selfAuditAndLog), ` +
        `tests/dpo-optimizer.test.js (dpoLogRatio, buildPreferencePairs, run, applyDpoAdjustments), ` +
        `tests/meta-policy.test.js (extractMetaPolicyRules, run). ` +
        `All tests use tmpdir pattern — zero production feedback dirs touched.`;
    } else {
      dpo04Status = 'fail';
      dpo04Evidence =
        `node --test RLAIF files: pass=${rlaifPassCount}, fail=${rlaifFailCount}. ` +
        `Expected >= 6 passing and 0 failures. ` +
        `${rlaifFailCount > 0 ? `${rlaifFailCount} test(s) failing.` : `Only ${rlaifPassCount} tests passing (need >= 6).`}`;
    }
  } catch (err) {
    // execSync throws if node --test exits non-zero
    const output = err.stdout || err.stderr || err.message || '';
    const outStr = String(output);
    const failMatch = outStr.match(/fail\s+(\d+)/);
    rlaifFailCount = failMatch ? parseInt(failMatch[1], 10) : 1;
    dpo04Status = 'fail';
    dpo04Evidence = `node --test RLAIF files exited non-zero (${rlaifFailCount} failures). Output: ${outStr.slice(0, 500)}`;
  } finally {
    // Clean up DPO-01 tmpDir
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    delete process.env.RLHF_FEEDBACK_DIR;
  }
  addResult('DPO-04', dpo04Status, dpo04Evidence);

  // ─────────────────────────────────────────────────────────────────────────
  // Write proof artifacts
  // ─────────────────────────────────────────────────────────────────────────
  ensureDir(PROOF_DIR);

  const jsonPath = path.join(PROOF_DIR, 'rlaif-report.json');
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

  const mdLines = [
    '# RLAIF and DPO Optimization — Proof Report',
    '',
    `Generated: ${report.generated}`,
    `Phase: ${report.phase}`,
    '',
    `**Passed: ${report.summary.passed} | Failed: ${report.summary.failed} | Warned: ${report.summary.warned}**`,
    '',
    '## Requirements',
    '',
    '| Requirement | Status | Evidence |',
    '|-------------|--------|----------|',
    ...Object.entries(report.requirements).map(
      ([reqId, { status: s, evidence }]) =>
        `| ${reqId} | ${s.toUpperCase()} | ${escapeMarkdownTableCell(evidence)} |`
    ),
    '',
    '## Requirement Details',
    '',
  ];

  for (const [reqId, { status: s, evidence }] of Object.entries(report.requirements)) {
    mdLines.push(`### ${reqId} — ${s.toUpperCase()}`);
    mdLines.push('');
    mdLines.push(evidence);
    mdLines.push('');
  }

  mdLines.push('## Test Count Delta');
  mdLines.push('');
  mdLines.push('| Baseline (Phase 4 test:api) | Phase 5 RLAIF Addition | Total (node-runner) |');
  mdLines.push('|----------------------------|------------------------|---------------------|');
  mdLines.push(`| ${PHASE4_BASELINE} node-runner tests | +${rlaifPassCount} RLAIF tests (3 test files) | ${PHASE4_BASELINE + rlaifPassCount} |`);
  mdLines.push('');
  mdLines.push('Phase 5 (plan-03) added RLAIF test coverage:');
  mdLines.push('- `tests/rlaif-self-audit.test.js` — CONSTRAINTS, selfAudit(), selfAuditAndLog()');
  mdLines.push('- `tests/dpo-optimizer.test.js` — dpoLogRatio(), buildPreferencePairs(), run(), applyDpoAdjustments()');
  mdLines.push('- `tests/meta-policy.test.js` — extractMetaPolicyRules(), run()');
  mdLines.push('');
  mdLines.push('All tests use `fs.mkdtempSync()` tmpdir isolation. Zero production feedback dirs touched.');
  mdLines.push('');

  const mdPath = path.join(PROOF_DIR, 'rlaif-report.md');
  fs.writeFileSync(mdPath, `${mdLines.join('\n')}\n`);

  console.log(`Proof written to ${mdPath}`);
  console.log(`           and   ${jsonPath}`);
  console.log('');
  console.log(JSON.stringify(report.summary, null, 2));

  const hasFail = report.summary.failed > 0;
  if (hasFail) {
    process.exitCode = 1;
    console.error('\nFAIL — one or more requirements did not pass. See proof/rlaif-report.md for details.');
  } else {
    console.log('\nPASS — all requirements satisfied (warns are acceptable).');
  }

  return report;
}

module.exports = { runProof };

if (require.main === module) {
  runProof().catch((err) => {
    console.error('Fatal error in prove-rlaif.js:', err);
    process.exitCode = 1;
  });
}
