'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PKG_ROOT = path.join(__dirname, '..');
const README_PATH = path.join(PKG_ROOT, 'README.md');
const DISTRIBUTION_DOC_PATH = path.join(PKG_ROOT, 'docs', 'PLUGIN_DISTRIBUTION.md');
const PRO_WORKFLOW_PATH = path.join(PKG_ROOT, '.github', 'workflows', 'publish-npm-pro.yml');
const EMBEDDED_PRO_DIR = path.join(PKG_ROOT, 'pro');
const SONAR_PROJECT_PATH = path.join(PKG_ROOT, 'sonar-project.properties');
test('public repo documents the single-package runtime unlock model', () => {
  const readme = fs.readFileSync(README_PATH, 'utf8');
  const distributionDoc = fs.readFileSync(DISTRIBUTION_DOC_PATH, 'utf8');
  assert.match(readme, /Runtime unlock model/i);
  assert.match(readme, /one public npm package/i);
  assert.match(readme, /pro --activate --key=YOUR_KEY/i);
  assert.match(distributionDoc, /Ship one public npm package/i);
  assert.match(distributionDoc, /same installed package unlocks Pro features at runtime/i);
});

test('public repo no longer embeds the Pro package subtree', () => {
  assert.equal(fs.existsSync(EMBEDDED_PRO_DIR), false, 'public repo should not ship a pro/ subtree');
});

test('public repo no longer publishes the Pro package', () => {
  assert.equal(fs.existsSync(PRO_WORKFLOW_PATH), false, 'public repo should not own Pro npm publishing');
});

test('public repo scanning config no longer references the deleted pro subtree', () => {
  const sonarConfig = fs.readFileSync(SONAR_PROJECT_PATH, 'utf8');
  assert.doesNotMatch(sonarConfig, /\*\*\/pro\/\*\*/);
});
