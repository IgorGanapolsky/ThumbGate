'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  timeDecayWeight,
  loadModel,
  createInitialModel,
  updateModel,
  getReliability,
  isCalibrated,
  getCalibration,
  samplePosteriors,
  argmaxPosteriors,
  pickBestCategory,
  DECAY_FLOOR,
  MIN_SAMPLES_THRESHOLD,
  DEFAULT_CATEGORIES,
} = require('../scripts/thompson-sampling');

describe('timeDecayWeight', () => {
  it('fresh timestamp returns ~1.0', () => {
    const w = timeDecayWeight(new Date().toISOString());
    assert.ok(w > 0.99, `expected > 0.99, got ${w}`);
    assert.ok(w <= 1.0, `expected <= 1.0, got ${w}`);
  });

  it('7-day-old timestamp returns ~0.5', () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const w = timeDecayWeight(sevenDaysAgo);
    assert.ok(w > 0.48, `expected > 0.48, got ${w}`);
    assert.ok(w < 0.52, `expected < 0.52, got ${w}`);
  });

  it('invalid string returns DECAY_FLOOR', () => {
    const w = timeDecayWeight('not-a-date');
    assert.strictEqual(w, DECAY_FLOOR);
  });

  it('null returns DECAY_FLOOR', () => {
    const w = timeDecayWeight(null);
    assert.strictEqual(w, DECAY_FLOOR);
  });

  it('365-day-old timestamp still >= DECAY_FLOOR', () => {
    const oldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const w = timeDecayWeight(oldDate);
    assert.ok(w >= DECAY_FLOOR, `expected >= ${DECAY_FLOOR}, got ${w}`);
  });
});

describe('createInitialModel', () => {
  it('has all DEFAULT_CATEGORIES with alpha=1.0 beta=1.0 samples=0', () => {
    const model = createInitialModel();
    assert.ok(model.categories, 'model should have categories');
    assert.strictEqual(model.total_entries, 0);
    for (const cat of DEFAULT_CATEGORIES) {
      const entry = model.categories[cat];
      assert.ok(entry, `category ${cat} should exist`);
      assert.strictEqual(entry.alpha, 1.0, `${cat}.alpha should be 1.0`);
      assert.strictEqual(entry.beta, 1.0, `${cat}.beta should be 1.0`);
      assert.strictEqual(entry.samples, 0, `${cat}.samples should be 0`);
    }
  });
});

describe('updateModel', () => {
  it('positive signal increments alpha', () => {
    const model = createInitialModel();
    const ts = new Date().toISOString();
    updateModel(model, { signal: 'positive', timestamp: ts, categories: ['testing'] });
    assert.ok(model.categories.testing.alpha > 1.0, `alpha should be > 1.0, got ${model.categories.testing.alpha}`);
    assert.strictEqual(model.categories.testing.beta, 1.0, 'beta should be unchanged at 1.0');
  });

  it('negative signal increments beta', () => {
    const model = createInitialModel();
    const ts = new Date().toISOString();
    updateModel(model, { signal: 'negative', timestamp: ts, categories: ['testing'] });
    assert.ok(model.categories.testing.beta > 1.0, `beta should be > 1.0, got ${model.categories.testing.beta}`);
    assert.strictEqual(model.categories.testing.alpha, 1.0, 'alpha should be unchanged at 1.0');
  });

  it('empty categories falls back to uncategorized', () => {
    const model = createInitialModel();
    const ts = new Date().toISOString();
    updateModel(model, { signal: 'positive', timestamp: ts, categories: [] });
    assert.ok(model.categories.uncategorized.alpha > 1.0, `uncategorized alpha should be > 1.0`);
  });

  it('unknown category auto-created', () => {
    const model = createInitialModel();
    const ts = new Date().toISOString();
    updateModel(model, { signal: 'positive', timestamp: ts, categories: ['new_category'] });
    assert.ok(model.categories.new_category, 'new_category should exist after update');
    assert.ok(model.categories.new_category.alpha > 1.0, `new_category.alpha should be > 1.0`);
  });

  it('total_entries increments', () => {
    const model = createInitialModel();
    const ts = new Date().toISOString();
    assert.strictEqual(model.total_entries, 0);
    updateModel(model, { signal: 'positive', timestamp: ts, categories: ['testing'] });
    assert.strictEqual(model.total_entries, 1);
    updateModel(model, { signal: 'negative', timestamp: ts, categories: ['git'] });
    assert.strictEqual(model.total_entries, 2);
  });

  it('weightMultiplier scales posterior updates', () => {
    const model = createInitialModel();
    const ts = new Date().toISOString();
    updateModel(model, {
      signal: 'positive',
      timestamp: ts,
      categories: ['testing'],
      weightMultiplier: 2,
    });
    assert.ok(model.categories.testing.alpha > 2.9, `alpha should reflect weighted update, got ${model.categories.testing.alpha}`);
  });
});

describe('getReliability', () => {
  it('reliability = alpha/(alpha+beta)', () => {
    const model = createInitialModel();
    // Manually set testing to alpha=3.0, beta=1.0 for deterministic check
    model.categories.testing.alpha = 3.0;
    model.categories.testing.beta = 1.0;
    const rel = getReliability(model);
    assert.ok(rel.testing, 'testing reliability entry should exist');
    assert.strictEqual(rel.testing.reliability, 0.75, `expected 0.75, got ${rel.testing.reliability}`);
    assert.strictEqual(rel.testing.alpha, 3.0);
    assert.strictEqual(rel.testing.beta, 1.0);
  });
});

describe('samplePosteriors', () => {
  it('each posterior in [0,1]', () => {
    const model = createInitialModel();
    const ts = new Date().toISOString();
    // Run 5 updates to build up posterior
    for (let i = 0; i < 5; i++) {
      updateModel(model, {
        signal: i % 2 === 0 ? 'positive' : 'negative',
        timestamp: ts,
        categories: ['testing'],
      });
    }
    const posteriors = samplePosteriors(model);
    for (const [cat, val] of Object.entries(posteriors)) {
      assert.ok(typeof val === 'number', `${cat} posterior should be a number`);
      assert.ok(val >= 0, `${cat} posterior should be >= 0, got ${val}`);
      assert.ok(val <= 1, `${cat} posterior should be <= 1, got ${val}`);
    }
  });
});

describe('loadModel', () => {
  it('missing file returns initial model', () => {
    const nonExistentPath = path.join(os.tmpdir(), `ts-test-missing-${Date.now()}.json`);
    const model = loadModel(nonExistentPath);
    assert.strictEqual(model.total_entries, 0, 'missing file should return initial model with total_entries=0');
    assert.ok(model.categories, 'should have categories');
  });

  it('reads existing file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-test-'));
    const tmpFile = path.join(tmpDir, 'feedback_model.json');
    try {
      // Write a model with specific total_entries
      const savedModel = createInitialModel();
      savedModel.total_entries = 42;
      fs.writeFileSync(tmpFile, JSON.stringify(savedModel, null, 2), 'utf-8');

      const loaded = loadModel(tmpFile);
      assert.strictEqual(loaded.total_entries, 42, `expected total_entries=42, got ${loaded.total_entries}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('MIN_SAMPLES_THRESHOLD', () => {
  it('is a positive integer', () => {
    assert.ok(Number.isInteger(MIN_SAMPLES_THRESHOLD));
    assert.ok(MIN_SAMPLES_THRESHOLD > 0);
  });
});

describe('isCalibrated', () => {
  it('returns false for fresh model (0 samples)', () => {
    const model = createInitialModel();
    assert.strictEqual(isCalibrated(model, 'testing'), false);
  });

  it('returns false below threshold', () => {
    const model = createInitialModel();
    const ts = new Date().toISOString();
    for (let i = 0; i < MIN_SAMPLES_THRESHOLD - 1; i++) {
      updateModel(model, { signal: 'positive', timestamp: ts, categories: ['testing'] });
    }
    assert.strictEqual(isCalibrated(model, 'testing'), false);
  });

  it('returns true at threshold', () => {
    const model = createInitialModel();
    const ts = new Date().toISOString();
    for (let i = 0; i < MIN_SAMPLES_THRESHOLD; i++) {
      updateModel(model, { signal: 'positive', timestamp: ts, categories: ['testing'] });
    }
    assert.strictEqual(isCalibrated(model, 'testing'), true);
  });

  it('returns false for nonexistent category', () => {
    const model = createInitialModel();
    assert.strictEqual(isCalibrated(model, 'nonexistent_xyz'), false);
  });
});

describe('getCalibration', () => {
  it('reports none confidence for fresh model', () => {
    const model = createInitialModel();
    const cal = getCalibration(model);
    assert.ok(cal.testing);
    assert.strictEqual(cal.testing.confidence, 'none');
    assert.strictEqual(cal.testing.calibrated, false);
    assert.strictEqual(cal.testing.samples, 0);
    assert.strictEqual(cal.testing.reliability, 0.5);
  });

  it('reports low confidence below threshold', () => {
    const model = createInitialModel();
    const ts = new Date().toISOString();
    updateModel(model, { signal: 'positive', timestamp: ts, categories: ['testing'] });
    updateModel(model, { signal: 'negative', timestamp: ts, categories: ['testing'] });
    const cal = getCalibration(model);
    assert.strictEqual(cal.testing.confidence, 'low');
    assert.strictEqual(cal.testing.calibrated, false);
    assert.strictEqual(cal.testing.samples, 2);
  });

  it('reports medium confidence at threshold', () => {
    const model = createInitialModel();
    const ts = new Date().toISOString();
    for (let i = 0; i < MIN_SAMPLES_THRESHOLD; i++) {
      updateModel(model, { signal: 'positive', timestamp: ts, categories: ['git'] });
    }
    const cal = getCalibration(model);
    assert.strictEqual(cal.git.confidence, 'medium');
    assert.strictEqual(cal.git.calibrated, true);
    assert.ok(cal.git.reliability > 0.5, 'reliability should be above prior with positive signals');
  });

  it('reports high confidence at 20+ samples', () => {
    const model = createInitialModel();
    const ts = new Date().toISOString();
    for (let i = 0; i < 20; i++) {
      updateModel(model, { signal: 'positive', timestamp: ts, categories: ['security'] });
    }
    const cal = getCalibration(model);
    assert.strictEqual(cal.security.confidence, 'high');
    assert.strictEqual(cal.security.calibrated, true);
  });

  it('covers all categories in the model', () => {
    const model = createInitialModel();
    const cal = getCalibration(model);
    for (const cat of DEFAULT_CATEGORIES) {
      assert.ok(cal[cat], `calibration should include ${cat}`);
      assert.ok(['none', 'low', 'medium', 'high'].includes(cal[cat].confidence));
    }
  });

  it('reliability reflects actual signal ratio when calibrated', () => {
    const model = createInitialModel();
    const ts = new Date().toISOString();
    // 8 positive, 2 negative = ~80% reliability (with priors: (1+8)/(2+10) ≈ 0.75)
    for (let i = 0; i < 8; i++) {
      updateModel(model, { signal: 'positive', timestamp: ts, categories: ['code_edit'] });
    }
    for (let i = 0; i < 2; i++) {
      updateModel(model, { signal: 'negative', timestamp: ts, categories: ['code_edit'] });
    }
    const cal = getCalibration(model);
    assert.ok(cal.code_edit.calibrated, 'should be calibrated at 10 samples');
    assert.ok(cal.code_edit.reliability > 0.7, `reliability should be > 0.7, got ${cal.code_edit.reliability}`);
    assert.ok(cal.code_edit.reliability < 0.85, `reliability should be < 0.85, got ${cal.code_edit.reliability}`);
  });
});

describe('dual-signal failureType', () => {
  it('creates decision sub-category when failureType=decision', () => {
    const model = createInitialModel();
    const ts = new Date().toISOString();
    updateModel(model, { signal: 'negative', timestamp: ts, categories: ['testing'], failureType: 'decision' });
    assert.ok(model.categories['testing:decision'], 'should create testing:decision sub-category');
    assert.ok(model.categories['testing:decision'].beta > 1.0, 'decision beta should be incremented');
    assert.equal(model.categories['testing:decision'].samples, 1);
  });

  it('creates execution sub-category when failureType=execution', () => {
    const model = createInitialModel();
    const ts = new Date().toISOString();
    updateModel(model, { signal: 'negative', timestamp: ts, categories: ['git'], failureType: 'execution' });
    assert.ok(model.categories['git:execution'], 'should create git:execution sub-category');
    assert.ok(model.categories['git:execution'].beta > 1.0, 'execution beta should be incremented');
  });

  it('updates both parent and sub-category', () => {
    const model = createInitialModel();
    const ts = new Date().toISOString();
    updateModel(model, { signal: 'negative', timestamp: ts, categories: ['testing'], failureType: 'decision' });
    assert.ok(model.categories.testing.beta > 1.0, 'parent beta should be incremented');
    assert.ok(model.categories['testing:decision'].beta > 1.0, 'sub-category beta should be incremented');
    assert.equal(model.categories.testing.samples, 1);
    assert.equal(model.categories['testing:decision'].samples, 1);
  });

  it('does not create sub-category when failureType is null', () => {
    const model = createInitialModel();
    const ts = new Date().toISOString();
    updateModel(model, { signal: 'negative', timestamp: ts, categories: ['testing'] });
    assert.ok(!model.categories['testing:decision'], 'should not create sub-category without failureType');
    assert.ok(!model.categories['testing:execution'], 'should not create sub-category without failureType');
  });

  it('positive signal with failureType updates sub-category alpha', () => {
    const model = createInitialModel();
    const ts = new Date().toISOString();
    updateModel(model, { signal: 'positive', timestamp: ts, categories: ['testing'], failureType: 'execution' });
    assert.ok(model.categories['testing:execution'].alpha > 1.0, 'sub-category alpha should be incremented on positive');
  });

  it('reliability diverges between decision and execution sub-arms', () => {
    const model = createInitialModel();
    const ts = new Date().toISOString();
    // 5 decision failures, 0 execution failures
    for (let i = 0; i < 5; i++) {
      updateModel(model, { signal: 'negative', timestamp: ts, categories: ['git'], failureType: 'decision' });
    }
    for (let i = 0; i < 5; i++) {
      updateModel(model, { signal: 'positive', timestamp: ts, categories: ['git'], failureType: 'execution' });
    }
    const rel = getReliability(model);
    assert.ok(rel['git:decision'].reliability < 0.3, `decision reliability should be low, got ${rel['git:decision'].reliability}`);
    assert.ok(rel['git:execution'].reliability > 0.7, `execution reliability should be high, got ${rel['git:execution'].reliability}`);
  });
});

describe('argmaxPosteriors (production/exploit mode)', () => {
  it('returns the posterior mean α/(α+β) for each category', () => {
    const model = {
      categories: {
        'a': { alpha: 9, beta: 1 }, // strong positive
        'b': { alpha: 1, beta: 9 }, // strong negative
        'c': { alpha: 5, beta: 5 }, // neutral
      },
    };
    const means = argmaxPosteriors(model);
    assert.ok(Math.abs(means.a - 0.9) < 1e-9);
    assert.ok(Math.abs(means.b - 0.1) < 1e-9);
    assert.ok(Math.abs(means.c - 0.5) < 1e-9);
  });

  it('guards against zero/negative α or β', () => {
    const model = {
      categories: {
        'ok': { alpha: 2, beta: 8 },
        'degen': { alpha: 0, beta: 0 },
        'negative': { alpha: -5, beta: -5 },
      },
    };
    const means = argmaxPosteriors(model);
    assert.ok(Number.isFinite(means.ok), 'finite for normal input');
    assert.ok(Number.isFinite(means.degen), 'finite for all-zero input (0.01/0.02 = 0.5)');
    assert.ok(Number.isFinite(means.negative), 'finite for negative input — clamped to 0.01');
    assert.equal(means.degen, 0.5);
  });

  it('returns {} for a model with no categories', () => {
    assert.deepEqual(argmaxPosteriors({}), {});
    assert.deepEqual(argmaxPosteriors({ categories: {} }), {});
  });

  it('is deterministic across calls (no sampling) — the whole point of exploit mode', () => {
    const model = { categories: { 'a': { alpha: 3, beta: 7 }, 'b': { alpha: 7, beta: 3 } } };
    const first = argmaxPosteriors(model);
    const second = argmaxPosteriors(model);
    const third = argmaxPosteriors(model);
    assert.deepEqual(first, second);
    assert.deepEqual(second, third);
  });
});

describe('pickBestCategory', () => {
  it('picks the category with the highest posterior mean', () => {
    const model = {
      categories: {
        'decisions': { alpha: 2, beta: 8 },
        'execution': { alpha: 9, beta: 1 },
        'identity': { alpha: 5, beta: 5 },
      },
    };
    assert.equal(pickBestCategory(model), 'execution');
  });

  it('breaks ties deterministically by lexicographic order', () => {
    const model = {
      categories: {
        'bravo': { alpha: 5, beta: 5 },
        'alpha': { alpha: 5, beta: 5 },
        'charlie': { alpha: 5, beta: 5 },
      },
    };
    // All three have mean 0.5; lexicographically-first wins.
    assert.equal(pickBestCategory(model), 'alpha');
  });

  it('returns null for a model with no categories', () => {
    assert.equal(pickBestCategory({}), null);
    assert.equal(pickBestCategory({ categories: {} }), null);
  });
});
