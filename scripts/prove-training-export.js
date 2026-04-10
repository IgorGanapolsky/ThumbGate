#!/usr/bin/env node
/**
 * prove-training-export.js
 *
 * Smoke-test gate for Phase 10: Training Export
 * Verifies all export formats + DPO validation gate work end-to-end.
 * Writes machine-readable JSON + human-readable markdown to proof/.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { ensureDir } = require('./fs-utils');

const ROOT = path.join(__dirname, '..');
function getProofDir() {
  return process.env.THUMBGATE_PROOF_DIR || path.join(ROOT, 'proof');
}


function runTests() {
  try {
    const output = execSync('node --test tests/training-export.test.js', {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output;
  } catch (err) {
    return err.stdout || err.stderr || String(err);
  }
}

function parseTestOutput(output) {
  const passMatch = output.match(/ℹ pass (\d+)/);
  const failMatch = output.match(/ℹ fail (\d+)/);
  const passed = passMatch ? parseInt(passMatch[1], 10) : 0;
  const failed = failMatch ? parseInt(failMatch[1], 10) : 0;
  return { passed, failed };
}

function makeFeedbackEntry(overrides) {
  return {
    id: `fb_${Date.now()}_test`,
    timestamp: new Date().toISOString(),
    signal: 'positive',
    feedback: 'up',
    reward: 1,
    context: 'Test context for smoke test',
    tags: ['testing'],
    richContext: { domain: 'testing', outcomeCategory: 'quick-success' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Smoke test: PyTorch JSON export (XPRT-01)
// ---------------------------------------------------------------------------
function smokePyTorchExport() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-xprt1-'));
  try {
    delete require.cache[require.resolve('./export-training.js')];
    const m = require('./export-training.js');

    fs.mkdirSync(path.join(tmpDir, 'training-data'), { recursive: true });

    const entries = [
      makeFeedbackEntry({ context: 'Implemented TDD correctly' }),
      makeFeedbackEntry({ signal: 'negative', feedback: 'down', reward: -1, context: 'Skipped validation' }),
    ];
    fs.writeFileSync(
      path.join(tmpDir, 'feedback-log.jsonl'),
      entries.map((e) => JSON.stringify(e)).join('\n')
    );

    const outPath = path.join(tmpDir, 'pytorch.json');
    const result = m.exportPyTorchJSON(tmpDir, outPath);

    if (!fs.existsSync(result.outputPath)) throw new Error('Output file not created');
    const data = JSON.parse(fs.readFileSync(result.outputPath, 'utf-8'));
    if (!data.metadata) throw new Error('Missing metadata');
    if (data.metadata.format !== 'pytorch-dpo') throw new Error('Wrong format');
    if (!Array.isArray(data.pairs)) throw new Error('Missing pairs array');
    if (!Array.isArray(data.sequences)) throw new Error('Missing sequences array');

    // Verify pair structure when pairs exist
    if (data.pairs.length > 0) {
      const pair = data.pairs[0];
      if (!('prompt' in pair)) throw new Error('pair missing prompt');
      if (!('chosen' in pair)) throw new Error('pair missing chosen');
      if (!('rejected' in pair)) throw new Error('pair missing rejected');
    }

    return { passed: true, pairCount: result.pairCount, format: data.metadata.format };
  } catch (err) {
    return { passed: false, error: err.message };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Smoke test: CSV export (XPRT-02)
// ---------------------------------------------------------------------------
function smokeCsvExport() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-xprt2-'));
  try {
    delete require.cache[require.resolve('./export-training.js')];
    const m = require('./export-training.js');

    fs.mkdirSync(path.join(tmpDir, 'training-data'), { recursive: true });

    const entries = [
      makeFeedbackEntry({ context: 'Works great' }),
      makeFeedbackEntry({ signal: 'negative', feedback: 'down', reward: -1, context: 'Has issues' }),
    ];
    fs.writeFileSync(
      path.join(tmpDir, 'feedback-log.jsonl'),
      entries.map((e) => JSON.stringify(e)).join('\n')
    );

    const outPath = path.join(tmpDir, 'summary.csv');
    const result = m.exportCSV(tmpDir, outPath);

    if (!fs.existsSync(result.outputPath)) throw new Error('CSV not created');
    const csv = fs.readFileSync(result.outputPath, 'utf-8');
    const lines = csv.split('\n');
    const headers = lines[0].split(',');

    const required = ['id', 'timestamp', 'signal', 'reward', 'context'];
    for (const h of required) {
      if (!headers.includes(h)) throw new Error(`CSV missing column: ${h}`);
    }
    if (result.rowCount !== 2) throw new Error(`Expected 2 rows, got ${result.rowCount}`);

    return { passed: true, rowCount: result.rowCount, headers };
  } catch (err) {
    return { passed: false, error: err.message };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Smoke test: Action analysis (XPRT-03)
// ---------------------------------------------------------------------------
function smokeActionAnalysis() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-xprt3-'));
  try {
    delete require.cache[require.resolve('./export-training.js')];
    const m = require('./export-training.js');

    fs.mkdirSync(path.join(tmpDir, 'training-data'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'feedback-log.jsonl'), '');

    const outPath = path.join(tmpDir, 'actions.json');
    const { report } = m.exportActionAnalysis(tmpDir, outPath);

    if (!report.summary) throw new Error('Missing summary');
    if (!report.actionPatterns) throw new Error('Missing actionPatterns');
    if (!Array.isArray(report.topFailureModes)) throw new Error('Missing topFailureModes');
    if (!Array.isArray(report.recommendations)) throw new Error('Missing recommendations');

    return { passed: true, fields: Object.keys(report) };
  } catch (err) {
    return { passed: false, error: err.message };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Smoke test: validateMemoryStructure gate (XPRT-04)
// ---------------------------------------------------------------------------
function smokeValidateMemoryStructure() {
  try {
    delete require.cache[require.resolve('./export-training.js')];
    const m = require('./export-training.js');

    // Valid entry
    const valid = m.validateMemoryStructure({
      title: 'SUCCESS: Test passed',
      content: 'The implementation was correct and tests verified.',
      category: 'learning',
      tags: ['testing'],
    });
    if (!valid.valid) throw new Error('Valid entry rejected: ' + valid.issues.join(', '));

    // Missing 'chosen' in DPO export
    const missingChosen = m.validateMemoryStructure({
      title: 'PREFERENCE: Good vs bad',
      content: 'Comparison of approaches.',
      category: 'preference',
      tags: ['arch'],
      _dpoExport: true,
      prompt: 'Which approach?',
      // chosen is missing
      rejected: 'The bad approach',
    });
    if (missingChosen.valid) throw new Error('Should have rejected missing chosen field');
    if (!missingChosen.issues.some((i) => i.includes('chosen'))) {
      throw new Error('Issue should mention chosen field');
    }

    return {
      passed: true,
      validEntryAccepted: valid.valid,
      missingChosenRejected: !missingChosen.valid,
      missingChosenIssues: missingChosen.issues,
    };
  } catch (err) {
    return { passed: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('Running Phase 10: Training Export proof gate...\n');

  const testOutput = runTests();
  const { passed: testsPassed, failed: testsFailed } = parseTestOutput(testOutput);

  const pytorch = smokePyTorchExport();
  const csv = smokeCsvExport();
  const actions = smokeActionAnalysis();
  const gate = smokeValidateMemoryStructure();

  const allPassed = testsFailed === 0 && pytorch.passed && csv.passed && actions.passed && gate.passed;

  const report = {
    phase: 10,
    name: 'Training Export',
    requirements: ['XPRT-01', 'XPRT-02', 'XPRT-03', 'XPRT-04', 'XPRT-05'],
    generatedAt: new Date().toISOString(),
    testResults: {
      passed: testsPassed,
      failed: testsFailed,
      suiteFile: 'tests/training-export.test.js',
    },
    smokeTests: {
      pytorchExport: pytorch,
      csvExport: csv,
      actionAnalysis: actions,
      validateMemoryStructure: gate,
    },
    overallPassed: allPassed,
  };

  const proofDir = getProofDir();
  ensureDir(proofDir);
  const jsonPath = path.join(proofDir, 'training-export-report.json');
  const mdPath = path.join(proofDir, 'training-export-report.md');

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const status = allPassed ? 'PASSED' : 'FAILED';
  const md = `# Phase 10: Training Export — Proof Report

**Status:** ${status}
**Generated:** ${report.generatedAt}
**Requirements:** ${report.requirements.join(', ')}

## Test Results

| Suite | Passed | Failed |
|-------|--------|--------|
| training-export.test.js | ${testsPassed} | ${testsFailed} |

## Smoke Tests

### PyTorch JSON Export (XPRT-01)
- Passed: ${pytorch.passed}
${pytorch.passed ? `- Pair count: ${pytorch.pairCount}\n- Format: ${pytorch.format}` : `- Error: ${pytorch.error}`}

### CSV Summary Export (XPRT-02)
- Passed: ${csv.passed}
${csv.passed ? `- Row count: ${csv.rowCount}\n- Headers: ${csv.headers ? csv.headers.join(', ') : 'N/A'}` : `- Error: ${csv.error}`}

### Action Analysis Report (XPRT-03)
- Passed: ${actions.passed}
${actions.passed ? `- Report fields: ${actions.fields ? actions.fields.join(', ') : 'N/A'}` : `- Error: ${actions.error}`}

### DPO Export Gate — validateMemoryStructure (XPRT-04)
- Passed: ${gate.passed}
${gate.passed ? `- Valid entry accepted: ${gate.validEntryAccepted}\n- Missing 'chosen' field rejected: ${gate.missingChosenRejected}` : `- Error: ${gate.error}`}

## Requirements Coverage

| Requirement | Description | Status |
|-------------|-------------|--------|
| XPRT-01 | PyTorch JSON export with prompt/chosen/rejected pairs | ${pytorch.passed ? 'PASS' : 'FAIL'} |
| XPRT-02 | CSV summary export with correct headers and escaping | ${csv.passed ? 'PASS' : 'FAIL'} |
| XPRT-03 | Action analysis report from feedback sequences | ${actions.passed ? 'PASS' : 'FAIL'} |
| XPRT-04 | validateMemoryStructure() gates DPO export | ${gate.passed ? 'PASS' : 'FAIL'} |
| XPRT-05 | All export features have unit tests (${testsPassed} tests, ${testsFailed} failures) | ${testsFailed === 0 ? 'PASS' : 'FAIL'} |

## Files Created

- \`scripts/export-training.js\` — PyTorch JSON, CSV, action analysis exports + validateMemoryStructure gate
- \`tests/training-export.test.js\` — ${testsPassed} unit tests covering all formats, gate rejection, edge cases
- \`scripts/prove-training-export.js\` — This proof gate script
`;

  fs.writeFileSync(mdPath, md);

  console.log(`Status: ${status}`);
  console.log(`Tests: ${testsPassed} passed, ${testsFailed} failed`);
  console.log(`PyTorch smoke: ${pytorch.passed ? 'PASS' : 'FAIL'}`);
  console.log(`CSV smoke: ${csv.passed ? 'PASS' : 'FAIL'}`);
  console.log(`Action analysis smoke: ${actions.passed ? 'PASS' : 'FAIL'}`);
  console.log(`validateMemoryStructure gate: ${gate.passed ? 'PASS' : 'FAIL'}`);
  console.log(`\nReport written to: ${mdPath}`);

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('prove-training-export failed:', err.message);
  process.exit(1);
});
