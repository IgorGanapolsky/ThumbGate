'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('experiment-tracker', () => {
  let tmpDir;
  let origEnv;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-test-'));
    origEnv = process.env.RLHF_FEEDBACK_DIR;
    process.env.RLHF_FEEDBACK_DIR = tmpDir;
  });

  afterEach(() => {
    if (origEnv === undefined) delete process.env.RLHF_FEEDBACK_DIR;
    else process.env.RLHF_FEEDBACK_DIR = origEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('createExperiment returns a pending experiment with ID', () => {
    const { createExperiment } = require('../scripts/experiment-tracker');
    const exp = createExperiment({ name: 'test-exp', hypothesis: 'it works' });
    assert.ok(exp.id.startsWith('exp_'));
    assert.strictEqual(exp.status, 'pending');
    assert.strictEqual(exp.name, 'test-exp');
  });

  it('createExperiment throws without name or hypothesis', () => {
    const { createExperiment } = require('../scripts/experiment-tracker');
    assert.throws(() => createExperiment({}), /requires name and hypothesis/);
  });

  it('createExperiment rejects invalid mutationType', () => {
    const { createExperiment } = require('../scripts/experiment-tracker');
    assert.throws(() => createExperiment({ name: 'x', hypothesis: 'y', mutationType: 'bad' }), /Invalid mutationType/);
  });

  it('recordResult marks experiment as completed with kept decision', () => {
    const { createExperiment, recordResult, loadExperiments } = require('../scripts/experiment-tracker');
    const exp = createExperiment({ name: 'rec-test', hypothesis: 'improve score' });
    const result = recordResult({ experimentId: exp.id, score: 0.9, baseline: 0.5 });
    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(result.kept, true);
    assert.ok(result.delta > 0);
  });

  it('recordResult discards when score does not improve', () => {
    const { createExperiment, recordResult } = require('../scripts/experiment-tracker');
    const exp = createExperiment({ name: 'no-improve', hypothesis: 'test' });
    const result = recordResult({ experimentId: exp.id, score: 0.3, baseline: 0.5 });
    assert.strictEqual(result.kept, false);
  });
});
