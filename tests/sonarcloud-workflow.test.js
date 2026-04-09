const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'sonarcloud.yml'), 'utf8');

test('SonarCloud workflow refreshes main and stamps scans with the package version', () => {
  assert.match(workflow, /push:\s*\n\s*branches:\s*\[main\]/);
  assert.match(workflow, /name: Read package version/);
  assert.match(workflow, /VERSION=\$\(node -p 'require\("\.\/package\.json"\)\.version'\)/);
  assert.match(workflow, /-Dsonar\.projectVersion=\$\{\{\s*steps\.package-version\.outputs\.version\s*\}\}/);
});

test('SonarCloud workflow waits on quality gates only for PR and merge-queue scans', () => {
  const gatedStart = workflow.indexOf('name: Run SonarCloud scan (quality gate)');
  const refreshStart = workflow.indexOf('name: Run SonarCloud scan (default branch refresh)');

  assert.notEqual(gatedStart, -1, 'gated SonarCloud step should exist');
  assert.notEqual(refreshStart, -1, 'default-branch refresh step should exist');
  assert.ok(gatedStart < refreshStart, 'quality gate step should appear before the refresh step');

  const gatedSection = workflow.slice(gatedStart, refreshStart);
  const refreshSection = workflow.slice(refreshStart);

  assert.match(gatedSection, /if:\s*github\.event_name == 'pull_request' \|\| github\.event_name == 'merge_group'/);
  assert.match(gatedSection, /-Dsonar\.qualitygate\.wait=true/);
  assert.match(gatedSection, /-Dsonar\.qualitygate\.timeout=600/);
  assert.match(refreshSection, /if:\s*github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'/);
  assert.doesNotMatch(refreshSection, /-Dsonar\.qualitygate\.wait=true/);
  assert.doesNotMatch(refreshSection, /-Dsonar\.qualitygate\.timeout=600/);
});
