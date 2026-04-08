'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  decidePublishPlan,
  getNpmTag,
  isPrereleaseVersion,
} = require('../scripts/publish-decision');

test('decidePublishPlan publishes a new untagged version', () => {
  const plan = decidePublishPlan({
    version: '0.8.5',
    currentSha: 'abc123',
    published: false,
    tagExists: false,
    tagSha: '',
  });

  assert.equal(plan.mode, 'publish');
  assert.equal(plan.createTag, true);
  assert.equal(plan.publishNpm, true);
  assert.equal(plan.npmTag, 'latest');
  assert.equal(plan.ensureRelease, true);
  assert.equal(plan.skipPublish, false);
});

test('decidePublishPlan resumes npm publish when the tag already matches the current commit', () => {
  const plan = decidePublishPlan({
    version: '0.8.5',
    currentSha: 'abc123',
    published: false,
    tagExists: true,
    tagSha: 'abc123',
  });

  assert.equal(plan.mode, 'publish');
  assert.equal(plan.createTag, false);
  assert.equal(plan.publishNpm, true);
  assert.equal(plan.npmTag, 'latest');
  assert.equal(plan.ensureRelease, true);
});

test('decidePublishPlan skips when the current commit is already fully released', () => {
  const plan = decidePublishPlan({
    version: '0.8.5',
    currentSha: 'abc123',
    published: true,
    tagExists: true,
    tagSha: 'abc123',
  });

  assert.equal(plan.mode, 'skip');
  assert.equal(plan.publishNpm, false);
  assert.equal(plan.npmTag, 'latest');
  assert.equal(plan.ensureRelease, true);
  assert.equal(plan.tagMatchesCurrentCommit, true);
});

test('decidePublishPlan skips routine merges when the same version was released from an earlier commit', () => {
  const plan = decidePublishPlan({
    version: '0.8.4',
    currentSha: 'new-commit',
    published: true,
    tagExists: true,
    tagSha: 'released-commit',
  });

  assert.equal(plan.mode, 'skip');
  assert.equal(plan.publishNpm, false);
  assert.equal(plan.createTag, false);
  assert.equal(plan.ensureRelease, false);
  assert.match(plan.reason, /already published from commit released-commit/);
});

test('decidePublishPlan rejects ambiguous published versions without tags', () => {
  assert.throws(() => {
    decidePublishPlan({
      version: '0.8.5',
      currentSha: 'abc123',
      published: true,
      tagExists: false,
      tagSha: '',
    });
  }, /already published on npm but has no remote tag/);
});

test('decidePublishPlan rejects mismatched unpublished tags', () => {
  assert.throws(() => {
    decidePublishPlan({
      version: '0.8.5',
      currentSha: 'abc123',
      published: false,
      tagExists: true,
      tagSha: 'other-commit',
    });
  }, /already exists at other-commit/);
});

test('decidePublishPlan refuses to publish from a non-default branch', () => {
  assert.throws(() => {
    decidePublishPlan({
      version: '0.8.5',
      currentSha: 'abc123',
      currentBranch: 'feat/release-test',
      defaultBranch: 'main',
      published: false,
      tagExists: false,
      tagSha: '',
    });
  }, /must run from main/);
});

test('prerelease versions publish to the next dist-tag', () => {
  const plan = decidePublishPlan({
    version: '1.1.0-beta.1',
    currentSha: 'abc123',
    published: false,
    tagExists: false,
    tagSha: '',
  });

  assert.equal(plan.publishNpm, true);
  assert.equal(plan.npmTag, 'next');
});

test('publish decision identifies prerelease and stable npm tags', () => {
  assert.equal(isPrereleaseVersion('1.0.0'), false);
  assert.equal(isPrereleaseVersion('1.1.0-beta.1'), true);
  assert.equal(getNpmTag('1.0.0'), 'latest');
  assert.equal(getNpmTag('1.1.0-rc.1'), 'next');
});
