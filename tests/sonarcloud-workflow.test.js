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
  assert.match(workflow, /name: Build Sonar mainline analysis version/);
  assert.match(workflow, /SHORT_SHA=\$\(printf '%s' "\$GITHUB_SHA" \| cut -c1-12\)/);
  assert.match(workflow, /echo "value=\$\{\{\s*steps\.package-version\.outputs\.version\s*\}\}\+sha\.\$SHORT_SHA" >> "\$GITHUB_OUTPUT"/);
  assert.match(workflow, /-Dsonar\.projectVersion=\$\{\{\s*steps\.package-version\.outputs\.version\s*\}\}/);
});

test('SonarCloud workflow polls quality gates only for PR and merge-queue scans', () => {
  const scanStart = workflow.indexOf('name: Run SonarCloud scan (pull request / merge queue)');
  const gatedStart = workflow.indexOf('name: Check SonarCloud quality gate');
  const refreshStart = workflow.indexOf('name: Run SonarCloud scan (default branch refresh)');

  assert.notEqual(scanStart, -1, 'pull-request SonarCloud scan step should exist');
  assert.notEqual(gatedStart, -1, 'gated SonarCloud step should exist');
  assert.notEqual(refreshStart, -1, 'default-branch refresh step should exist');
  assert.ok(scanStart < gatedStart, 'scan step should appear before the quality gate step');
  assert.ok(gatedStart < refreshStart, 'quality gate step should appear before the refresh step');

  const scanSection = workflow.slice(scanStart, gatedStart);
  const gatedSection = workflow.slice(gatedStart, refreshStart);
  const refreshSection = workflow.slice(refreshStart);

  assert.match(
    scanSection,
    /if:\s*steps\.sonar-scope\.outputs\.scan == 'true' && !\(github\.event_name == 'pull_request' && github\.event\.pull_request\.user\.login == 'dependabot\[bot\]'\) && \(github\.event_name == 'pull_request' \|\| github\.event_name == 'merge_group'\)/,
  );
  assert.match(scanSection, /uses:\s*SonarSource\/sonarqube-scan-action@v7\.1\.0/);
  assert.match(scanSection, /-Dsonar\.projectVersion=\$\{\{\s*steps\.package-version\.outputs\.version\s*\}\}/);
  assert.doesNotMatch(scanSection, /qualitygate\.wait=true/);
  assert.doesNotMatch(scanSection, /qualitygate\.timeout=600/);
  assert.match(
    gatedSection,
    /if:\s*steps\.sonar-scope\.outputs\.scan == 'true' && !\(github\.event_name == 'pull_request' && github\.event\.pull_request\.user\.login == 'dependabot\[bot\]'\) && \(github\.event_name == 'pull_request' \|\| github\.event_name == 'merge_group'\)/,
  );
  assert.match(gatedSection, /uses:\s*SonarSource\/sonarqube-quality-gate-action@v1\.2\.0/);
  assert.match(gatedSection, /pollingTimeoutSec:\s*600/);
  assert.match(
    refreshSection,
    /if:\s*steps\.sonar-scope\.outputs\.scan == 'true' && !\(github\.event_name == 'pull_request' && github\.event\.pull_request\.user\.login == 'dependabot\[bot\]'\) && \(github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'\)/,
  );
  assert.match(refreshSection, /-Dsonar\.projectVersion=\$\{\{\s*steps\.sonar-mainline-version\.outputs\.value\s*\}\}/);
  assert.doesNotMatch(refreshSection, /-Dsonar\.qualitygate\.wait=true/);
  assert.doesNotMatch(refreshSection, /-Dsonar\.qualitygate\.timeout=600/);
});

test('SonarCloud workflow skips scanner startup for PRs outside scanned surfaces', () => {
  assert.match(workflow, /name: Detect Sonar-relevant changes/);
  assert.match(workflow, /id: sonar-scope/);
  assert.match(workflow, /git diff --name-only "\$BASE_SHA" "\$HEAD_SHA" > \/tmp\/sonar-changed-files\.txt/);
  assert.match(workflow, /\^\(src\/\|scripts\/\|bin\/\|package\(-lock\)\?\\\.json\$\|sonar-project\\\.properties\$\|\\\.github\/workflows\/sonarcloud\\\.yml\$\)/);
  assert.doesNotMatch(workflow, /\|tests\/\|/);
  assert.match(workflow, /name: Skip SonarCloud scan for non-Sonar PR/);
  assert.match(workflow, /if: steps\.sonar-scope\.outputs\.scan == 'false'/);
  assert.match(workflow, /required SonarCloud job exits successfully without scanner startup/);
});

test('SonarCloud workflow caches scanner packages for real scans', () => {
  const cacheStart = workflow.indexOf('name: Cache SonarCloud packages');
  const installStart = workflow.indexOf('name: Install deps');

  assert.notEqual(cacheStart, -1, 'SonarCloud cache step should exist');
  assert.notEqual(installStart, -1, 'dependency install step should exist');
  assert.ok(cacheStart < installStart, 'Sonar cache should restore before dependency install and scanner startup');

  const cacheSection = workflow.slice(cacheStart, installStart);

  assert.match(cacheSection, /if: steps\.sonar-scope\.outputs\.scan == 'true'/);
  assert.match(cacheSection, /uses: actions\/cache@v5/);
  assert.match(cacheSection, /path: ~\/\.sonar\/cache/);
  assert.match(cacheSection, /key: \$\{\{\s*runner\.os\s*\}\}-sonar/);
  assert.match(cacheSection, /restore-keys: \$\{\{\s*runner\.os\s*\}\}-sonar/);
});
