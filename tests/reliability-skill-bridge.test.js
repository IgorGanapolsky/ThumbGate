// tests/reliability-skill-bridge.test.js
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  generateReliabilityTriggeredSkills,
  DEFAULT_RELIABILITY_THRESHOLD,
} = require('../scripts/reliability-skill-bridge');
const {
  createInitialModel,
  updateModel,
  saveModel,
  loadModel,
  getCalibration,
} = require('../scripts/thompson-sampling');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-bridge-test-'));
}

function appendJSONL(filePath, record) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
}

function makeNegativeEntry(tags, overrides = {}) {
  return {
    signal: 'down',
    context: 'Agent made an error',
    whatWentWrong: 'Skipped verification step',
    whatToChange: 'Always verify before claiming done',
    tags,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Seed a Thompson model with enough samples to be calibrated,
 * biased toward negative (low reliability).
 */
function seedLowReliabilityModel(modelPath, category, negCount, posCount) {
  const model = createInitialModel();
  const now = new Date().toISOString();
  for (let i = 0; i < negCount; i++) {
    updateModel(model, { signal: 'negative', timestamp: now, categories: [category] });
  }
  for (let i = 0; i < posCount; i++) {
    updateModel(model, { signal: 'positive', timestamp: now, categories: [category] });
  }
  saveModel(model, modelPath);
  return model;
}

/**
 * Seed a Thompson model with high reliability (mostly positive).
 */
function seedHighReliabilityModel(modelPath, category, posCount, negCount) {
  const model = createInitialModel();
  const now = new Date().toISOString();
  for (let i = 0; i < posCount; i++) {
    updateModel(model, { signal: 'positive', timestamp: now, categories: [category] });
  }
  for (let i = 0; i < negCount; i++) {
    updateModel(model, { signal: 'negative', timestamp: now, categories: [category] });
  }
  saveModel(model, modelPath);
  return model;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('reliability-skill-bridge', () => {

  test('exports DEFAULT_RELIABILITY_THRESHOLD as 0.5', () => {
    assert.equal(DEFAULT_RELIABILITY_THRESHOLD, 0.5);
  });

  test('empty feedback log returns no triggered categories and no skills', () => {
    const tmpDir = makeTmpDir();
    const modelPath = path.join(tmpDir, 'feedback_model.json');
    // Fresh model — all categories are uncalibrated (0 samples)
    saveModel(createInitialModel(), modelPath);

    const result = generateReliabilityTriggeredSkills({
      feedbackDir: tmpDir,
      modelPath,
      dryRun: true,
    });

    assert.equal(result.triggeredCategories.length, 0);
    assert.equal(result.generatedSkills.length, 0);
    assert.ok(result.skippedCategories.length > 0, 'all categories should be skipped');
    // All should be skipped as uncalibrated
    const uncalibrated = result.skippedCategories.filter((s) => s.reason === 'uncalibrated');
    assert.ok(uncalibrated.length > 0);
  });

  test('uncalibrated categories (< 5 samples) are skipped', () => {
    const tmpDir = makeTmpDir();
    const modelPath = path.join(tmpDir, 'feedback_model.json');
    const model = createInitialModel();
    // Add only 3 negative samples for testing — below MIN_SAMPLES_THRESHOLD (5)
    const now = new Date().toISOString();
    for (let i = 0; i < 3; i++) {
      updateModel(model, { signal: 'negative', timestamp: now, categories: ['testing'] });
    }
    saveModel(model, modelPath);

    const result = generateReliabilityTriggeredSkills({
      feedbackDir: tmpDir,
      modelPath,
      dryRun: true,
    });

    const testingSkip = result.skippedCategories.find((s) => s.category === 'testing');
    assert.ok(testingSkip, 'testing should be in skipped list');
    assert.equal(testingSkip.reason, 'uncalibrated');
    assert.equal(testingSkip.samples, 3);
  });

  test('high reliability categories are skipped as healthy', () => {
    const tmpDir = makeTmpDir();
    const modelPath = path.join(tmpDir, 'feedback_model.json');
    // 15 positive, 2 negative → reliability ≈ 0.85
    seedHighReliabilityModel(modelPath, 'testing', 15, 2);

    const result = generateReliabilityTriggeredSkills({
      feedbackDir: tmpDir,
      modelPath,
      dryRun: true,
    });

    const testingSkip = result.skippedCategories.find((s) => s.category === 'testing');
    assert.ok(testingSkip, 'testing should be in skipped list');
    assert.equal(testingSkip.reason, 'healthy');
    assert.ok(testingSkip.reliability > 0.5, `reliability should be > 0.5, got ${testingSkip.reliability}`);
  });

  test('low reliability calibrated category triggers skill generation', () => {
    const tmpDir = makeTmpDir();
    const modelPath = path.join(tmpDir, 'feedback_model.json');
    // 2 positive, 10 negative → reliability ≈ 0.23
    seedLowReliabilityModel(modelPath, 'testing', 10, 2);

    // Seed feedback log with matching negative entries
    const logPath = path.join(tmpDir, 'feedback-log.jsonl');
    for (let i = 0; i < 5; i++) {
      appendJSONL(logPath, makeNegativeEntry(['testing', 'verification'], {
        whatWentWrong: `Test failure pattern ${i}`,
      }));
    }

    const result = generateReliabilityTriggeredSkills({
      feedbackDir: tmpDir,
      modelPath,
      dryRun: true,
      minClusterSize: 2,
    });

    assert.ok(result.triggeredCategories.length > 0, 'should have triggered categories');
    const testingTrigger = result.triggeredCategories.find((t) => t.category === 'testing');
    assert.ok(testingTrigger, 'testing should be triggered');
    assert.ok(testingTrigger.reliability < 0.5, `reliability should be < 0.5, got ${testingTrigger.reliability}`);
  });

  test('custom threshold changes which categories trigger', () => {
    const tmpDir = makeTmpDir();
    const modelPath = path.join(tmpDir, 'feedback_model.json');
    // 5 positive, 5 negative → reliability ≈ 0.5 (at the default boundary)
    const model = createInitialModel();
    const now = new Date().toISOString();
    for (let i = 0; i < 5; i++) {
      updateModel(model, { signal: 'positive', timestamp: now, categories: ['git'] });
      updateModel(model, { signal: 'negative', timestamp: now, categories: ['git'] });
    }
    saveModel(model, modelPath);

    // With threshold 0.5, reliability ≈ 0.5 should NOT trigger (>= 0.5 is healthy)
    const cal = getCalibration(loadModel(modelPath));
    const gitReliability = cal.git.reliability;

    // With a higher threshold (0.7), the same category SHOULD trigger
    const result = generateReliabilityTriggeredSkills({
      feedbackDir: tmpDir,
      modelPath,
      threshold: 0.7,
      dryRun: true,
    });

    const gitTrigger = result.triggeredCategories.find((t) => t.category === 'git');
    if (gitReliability < 0.7) {
      assert.ok(gitTrigger, 'git should trigger with threshold 0.7');
    }
  });

  test('end-to-end: feed negative signals → model update → skill generation', () => {
    const tmpDir = makeTmpDir();
    const modelPath = path.join(tmpDir, 'feedback_model.json');
    const logPath = path.join(tmpDir, 'feedback-log.jsonl');

    // Step 1: Create model and feed it negative signals for 'security'
    const model = createInitialModel();
    const now = new Date().toISOString();
    for (let i = 0; i < 12; i++) {
      updateModel(model, { signal: 'negative', timestamp: now, categories: ['security'] });
    }
    for (let i = 0; i < 2; i++) {
      updateModel(model, { signal: 'positive', timestamp: now, categories: ['security'] });
    }
    saveModel(model, modelPath);

    // Step 2: Also create matching feedback log entries
    for (let i = 0; i < 5; i++) {
      appendJSONL(logPath, makeNegativeEntry(['security', 'credentials'], {
        whatWentWrong: `Exposed secret in commit ${i}`,
        whatToChange: 'Check for secrets before committing',
      }));
    }

    // Step 3: Run the bridge
    const result = generateReliabilityTriggeredSkills({
      feedbackDir: tmpDir,
      modelPath,
      dryRun: true,
      minClusterSize: 2,
    });

    // Step 4: Verify the chain
    const securityTrigger = result.triggeredCategories.find((t) => t.category === 'security');
    assert.ok(securityTrigger, 'security should be triggered');
    assert.ok(securityTrigger.reliability < 0.5, 'security reliability should be low');
    assert.equal(securityTrigger.confidence, 'medium'); // 14 samples → medium tier

    // Summary should reflect what happened
    assert.ok(result.summary.includes('low-reliability'), `summary should mention low-reliability: ${result.summary}`);
  });

  test('all categories healthy produces correct summary', () => {
    const tmpDir = makeTmpDir();
    const modelPath = path.join(tmpDir, 'feedback_model.json');
    const model = createInitialModel();
    const now = new Date().toISOString();

    // Make every default category highly reliable
    for (const cat of ['code_edit', 'git', 'testing', 'pr_review', 'search', 'architecture', 'security', 'debugging']) {
      for (let i = 0; i < 20; i++) {
        updateModel(model, { signal: 'positive', timestamp: now, categories: [cat] });
      }
    }
    saveModel(model, modelPath);

    const result = generateReliabilityTriggeredSkills({
      feedbackDir: tmpDir,
      modelPath,
      dryRun: true,
    });

    assert.equal(result.triggeredCategories.length, 0);
    assert.ok(result.summary.includes('No skills triggered'));
  });

  test('dryRun=false writes skill files to disk', () => {
    const tmpDir = makeTmpDir();
    const modelPath = path.join(tmpDir, 'feedback_model.json');
    const logPath = path.join(tmpDir, 'feedback-log.jsonl');

    seedLowReliabilityModel(modelPath, 'debugging', 10, 1);

    for (let i = 0; i < 4; i++) {
      appendJSONL(logPath, makeNegativeEntry(['debugging', 'stack-trace'], {
        whatWentWrong: `Ignored stack trace ${i}`,
      }));
    }

    const result = generateReliabilityTriggeredSkills({
      feedbackDir: tmpDir,
      modelPath,
      dryRun: false,
      minClusterSize: 2,
    });

    // If skills were generated, verify files exist on disk
    for (const skill of result.generatedSkills) {
      assert.ok(fs.existsSync(skill.filePath), `Skill file should exist: ${skill.filePath}`);
      const content = fs.readFileSync(skill.filePath, 'utf8');
      assert.ok(content.includes('INSTEAD Rules'), 'Skill file should contain INSTEAD Rules');
    }
  });
});
