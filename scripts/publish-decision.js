#!/usr/bin/env node
'use strict';

function normalizeBoolean(value) {
  return String(value).trim().toLowerCase() === 'true';
}

function isPrereleaseVersion(version) {
  return /^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/.test(String(version || '').trim());
}

function getNpmTag(version) {
  return isPrereleaseVersion(version) ? 'next' : 'latest';
}

function decidePublishPlan(options) {
  const currentSha = String(options.currentSha || '').trim();
  const tagSha = String(options.tagSha || '').trim();
  const version = String(options.version || '').trim();
  const currentBranch = String(options.currentBranch || '').trim();
  const defaultBranch = String(options.defaultBranch || '').trim();
  const published = normalizeBoolean(options.published);
  const tagExists = normalizeBoolean(options.tagExists);
  const tagMatchesCurrentCommit = tagExists && tagSha === currentSha;
  const npmTag = getNpmTag(version);

  if (!version) {
    throw new Error('VERSION is required.');
  }

  if (!currentSha) {
    throw new Error('CURRENT_SHA is required.');
  }

  if (currentBranch && defaultBranch && currentBranch !== defaultBranch) {
    throw new Error(
      `Refusing to publish from ${currentBranch}. Publish workflow must run from ${defaultBranch}.`
    );
  }

  if (published && !tagExists) {
    throw new Error(
      `Version ${version} is already published on npm but has no remote tag. Recover from the original release commit or bump the version.`
    );
  }

  if (tagExists && !tagSha) {
    throw new Error(`Tag v${version} exists but has no resolved SHA.`);
  }

  if (tagExists && !tagMatchesCurrentCommit && !published) {
    throw new Error(
      `Tag v${version} already exists at ${tagSha}, not ${currentSha}, and npm does not have that version yet. Refusing to publish from an ambiguous commit.`
    );
  }

  if (!tagExists && !published) {
    return {
      mode: 'publish',
      reason: `Version ${version} is new. Create tag v${version}, publish to npm, and create a GitHub Release.`,
      createTag: true,
      publishNpm: true,
      npmTag,
      ensureRelease: true,
      skipPublish: false,
      tagMatchesCurrentCommit: false,
    };
  }

  if (tagMatchesCurrentCommit && !published) {
    return {
      mode: 'publish',
      reason: `Tag v${version} already points at ${currentSha}. Resume npm publish without recreating the tag.`,
      createTag: false,
      publishNpm: true,
      npmTag,
      ensureRelease: true,
      skipPublish: false,
      tagMatchesCurrentCommit: true,
    };
  }

  if (tagMatchesCurrentCommit && published) {
    return {
      mode: 'skip',
      reason: `Version ${version} is already published from the current commit ${currentSha}.`,
      createTag: false,
      publishNpm: false,
      npmTag,
      ensureRelease: true,
      skipPublish: true,
      tagMatchesCurrentCommit: true,
    };
  }

  return {
    mode: 'skip',
    reason: `Version ${version} is already published from commit ${tagSha}. Skip npm publish for this merge because package version did not change.`,
    createTag: false,
    publishNpm: false,
    npmTag,
    ensureRelease: false,
    skipPublish: true,
    tagMatchesCurrentCommit: false,
  };
}

function writeGithubOutputs(plan, outputPath) {
  if (!outputPath) {
    return;
  }

  const lines = [
    `mode=${plan.mode}`,
    `reason=${plan.reason}`,
    `create_tag=${String(plan.createTag)}`,
    `publish_npm=${String(plan.publishNpm)}`,
    `npm_tag=${plan.npmTag}`,
    `ensure_release=${String(plan.ensureRelease)}`,
    `skip_publish=${String(plan.skipPublish)}`,
    `tag_matches_current_commit=${String(plan.tagMatchesCurrentCommit)}`,
  ];

  require('node:fs').appendFileSync(outputPath, `${lines.join('\n')}\n`);
}

function runCli(env = process.env) {
  const plan = decidePublishPlan({
    version: env.VERSION,
    currentSha: env.CURRENT_SHA || env.GITHUB_SHA,
    currentBranch: env.CURRENT_BRANCH || env.GITHUB_REF_NAME,
    defaultBranch: env.DEFAULT_BRANCH,
    published: env.NPM_PUBLISHED,
    tagExists: env.TAG_EXISTS,
    tagSha: env.TAG_SHA,
  });

  console.log(plan.reason);
  writeGithubOutputs(plan, env.GITHUB_OUTPUT);
  return plan;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  decidePublishPlan,
  getNpmTag,
  isPrereleaseVersion,
  normalizeBoolean,
  runCli,
  writeGithubOutputs,
};
