'use strict';

// CodeQL init + analyze MUST use the same action SHA. Dependabot previously
// opened half-bumps (#3483/#3484) that failed with:
//   Loaded a configuration file for version X, but running version Y
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const codeqlWorkflow = fs.readFileSync(
  path.join(PROJECT_ROOT, '.github', 'workflows', 'codeql.yml'),
  'utf8',
);
const dependabot = fs.readFileSync(
  path.join(PROJECT_ROOT, '.github', 'dependabot.yml'),
  'utf8',
);

function pinFor(step) {
  const re = new RegExp(
    `uses:\\s*github/codeql-action/${step}@([0-9a-f]{40})\\s*#\\s*(v[\\d.]+)`,
  );
  const m = codeqlWorkflow.match(re);
  assert.ok(m, `codeql.yml must pin github/codeql-action/${step}@<sha> # vX.Y.Z`);
  return { sha: m[1], tag: m[2] };
}

// Immutable pin for github/codeql-action@v4.37.9 (init + analyze must share it).
// Peeled tag SHA verified via git ls-remote refs/tags/v4.37.9^{}.
const CODEQL_V4379_SHA = 'cdf488f595d80d6e07e03d4674febd5ab45fa938';

test('CodeQL init and analyze use the same action SHA and version tag', () => {
  const init = pinFor('init');
  const analyze = pinFor('analyze');
  assert.equal(
    init.sha,
    analyze.sha,
    `CodeQL init (${init.sha}) and analyze (${analyze.sha}) must match; `
      + 'split Dependabot bumps break Analyze with a version-mismatch error',
  );
  assert.equal(init.tag, analyze.tag, 'CodeQL init/analyze version comments must match');
  assert.match(init.tag, /^v4\./, 'CodeQL action should stay on the v4 line');
  assert.equal(
    init.sha,
    CODEQL_V4379_SHA,
    `CodeQL must stay pinned to immutable v4.37.9 revision ${CODEQL_V4379_SHA}`,
  );
  assert.equal(init.tag, 'v4.37.9', 'CodeQL version comment must be v4.37.9');
});

test('Dependabot groups github/codeql-action* so init/analyze do not half-bump', () => {
  assert.match(dependabot, /package-ecosystem:\s*"github-actions"/);
  assert.match(dependabot, /groups:\s*\n\s*codeql-action:/);
  assert.match(dependabot, /patterns:\s*\n\s*-\s*"github\/codeql-action\*"/);
});
