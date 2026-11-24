'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EXIT, branchNameFor, classifyPrState, slugify } = require('../scripts/ship');
const { loadPolicy } = require('../scripts/ship-policy');

const policy = loadPolicy();
const green = [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }];

test('branch names come from the commit subject without the conventional prefix', () => {
  assert.equal(slugify('fix(site): serve /connectors, drop dead sitemap entry'), 'serve-connectors-drop-dead-sitemap-entry');
  assert.equal(slugify('!!!'), 'change');
  assert.equal(branchNameFor('feat: add X', new Date('2026-11-24T10:00:00Z')), 'ship/add-x-20261124');
  assert.ok(policy.autoMerge.allowedBranchPrefixes.includes('ship/'), 'ship/ branches must be routine');
});

test('classifyPrState maps PR state to exit codes', () => {
  assert.equal(classifyPrState({ state: 'MERGED', mergeCommit: { oid: 'abc' } }, policy).code, EXIT.merged);
  assert.equal(classifyPrState({ state: 'CLOSED' }, policy).code, EXIT.red);
  assert.equal(classifyPrState({ state: 'OPEN', labels: [{ name: 'needs-igor' }], statusCheckRollup: green }, policy).code, EXIT.human);
  assert.equal(classifyPrState({ state: 'OPEN', labels: ['do-not-merge'] }, policy).code, EXIT.human);
  assert.equal(classifyPrState({ state: 'OPEN', labels: ['igor-review'], statusCheckRollup: green }, policy).code, EXIT.human);
  assert.equal(classifyPrState({ state: 'OPEN', mergeStateStatus: 'DIRTY' }, policy).code, EXIT.conflict);
  const red = classifyPrState({ state: 'OPEN', statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }] }, policy);
  assert.equal(red.code, EXIT.red);
  assert.deepEqual(red.failing, ['test']);
  assert.equal(classifyPrState({ state: 'OPEN', labels: ['needs-fix'], statusCheckRollup: green }, policy).code, EXIT.red);
  assert.equal(classifyPrState({ state: 'OPEN', statusCheckRollup: [{ name: 'test', status: 'IN_PROGRESS' }] }, policy).done, false);
  assert.equal(classifyPrState({ state: 'OPEN', statusCheckRollup: green }, policy).done, false, 'green but unmerged keeps waiting');
  // A fresh push has no checks yet: a stale needs-fix label must not end the wait.
  assert.equal(classifyPrState({ state: 'OPEN', labels: ['needs-fix'], statusCheckRollup: [] }, policy).done, false);
});

test('ghEnv promotes GH_PAT only when no token is set', () => {
  const { ghEnv } = require('../scripts/ship');
  assert.equal(ghEnv({ GH_PAT: 'p' }).GH_TOKEN, 'p');
  assert.equal(ghEnv({ GH_PAT: 'p', GH_TOKEN: 't' }).GH_TOKEN, 't');
  assert.equal(ghEnv({ GH_PAT: 'p', GITHUB_TOKEN: 'g' }).GH_TOKEN, undefined);
});

test('ship never force-pushes, never skips hooks, never opens drafts', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'ship.js'), 'utf8');
  const pushes = src.match(/\['push'[^\]]*\]/g) || [];
  assert.equal(pushes.length, 1);
  assert.doesNotMatch(pushes[0], /force|'-f'/);
  assert.doesNotMatch(src, new RegExp("'--no" + "-verify'"));
  assert.doesNotMatch(src, /'--draft'/);
  assert.doesNotMatch(src, /'--admin'/);
  assert.doesNotMatch(src, /'--remove-label'/, 'label churn would cancel the gate run');
});
