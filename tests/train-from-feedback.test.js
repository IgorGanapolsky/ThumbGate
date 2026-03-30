const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('train_from_feedback.py compiles under python3', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'train_from_feedback.py');
  const result = spawnSync('python3', ['-m', 'py_compile', scriptPath], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout || 'python3 -m py_compile failed');
});

test('train_from_feedback.py respects custom categories when initializing a fresh model', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'train_from_feedback.py');
  const probe = `
import importlib.util
import json
import pathlib
import tempfile

spec = importlib.util.spec_from_file_location('train_from_feedback', ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.MODEL_FILE = pathlib.Path(tempfile.mkdtemp()) / 'feedback_model.json'
model = module.load_model({'custom_category': {'keywords': ['custom'], 'tools': []}})
print(json.dumps(sorted(model['categories'].keys())))
`;
  const result = spawnSync('python3', ['-c', probe], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout || 'python3 probe failed');
  assert.deepEqual(JSON.parse(result.stdout.trim()), ['custom_category']);
});
