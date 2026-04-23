const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildAwsAccessKeyId,
  buildGitHubPat,
  buildOpenAiLegacyKey,
  buildOpenAiProjectKey,
  buildPemHeader,
} = require('../scripts/secret-fixture-tokens');

const ROOT = path.join(__dirname, '..');
const TARGET_FILES = [
  'config/evals/agent-safety-eval.json',
  'scripts/gate-coherence.js',
  'tests/spec-gate.test.js',
  'tests/gate-coherence.test.js',
  'tests/gate-eval.test.js',
];

const FORBIDDEN_LITERALS = [
  buildAwsAccessKeyId(),
  buildGitHubPat(),
  buildOpenAiLegacyKey(),
  buildOpenAiProjectKey(),
  buildPemHeader('RSA '),
  buildPemHeader('EC '),
  buildPemHeader(''),
];

test('secret fixtures stay scanner-safe in committed eval and test sources', () => {
  for (const relativePath of TARGET_FILES) {
    const filePath = path.join(ROOT, relativePath);
    const source = fs.readFileSync(filePath, 'utf8');
    for (const literal of FORBIDDEN_LITERALS) {
      assert.equal(
        source.includes(literal),
        false,
        `${relativePath} still contains scanner-triggering fixture literal: ${literal}`,
      );
    }
  }
});
