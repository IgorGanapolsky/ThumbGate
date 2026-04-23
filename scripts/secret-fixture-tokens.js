'use strict';

const FIXTURE_TOKENS = {
  awsAccessKeyId: '__TG_FIXTURE_AWS_ACCESS_KEY_ID__',
  githubPat: '__TG_FIXTURE_GITHUB_PAT__',
  openAiLegacyKey: '__TG_FIXTURE_OPENAI_LEGACY_KEY__',
  openAiProjectKey: '__TG_FIXTURE_OPENAI_PROJECT_KEY__',
  rsaPrivateKeyHeader: '__TG_FIXTURE_RSA_PRIVATE_KEY_HEADER__',
  ecPrivateKeyHeader: '__TG_FIXTURE_EC_PRIVATE_KEY_HEADER__',
  privateKeyHeader: '__TG_FIXTURE_PRIVATE_KEY_HEADER__',
};

function buildAwsAccessKeyId() {
  return ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
}

function buildGitHubPat() {
  return ['gh', 'p_', 'x'.repeat(36)].join('');
}

function buildOpenAiLegacyKey() {
  return ['sk', '-', 'abcdefghijklmnopqrstuvwxyz01234567890'].join('');
}

function buildOpenAiProjectKey() {
  return ['sk', '-proj-', 'abcdefghijklmnopqrstuvwxyz01234567890'].join('');
}

function buildPemHeader(prefix = '') {
  return ['-----BEGIN ', prefix, 'PRIVATE KEY-----'].join('');
}

function fixtureReplacements() {
  return [
    [FIXTURE_TOKENS.awsAccessKeyId, buildAwsAccessKeyId()],
    [FIXTURE_TOKENS.githubPat, buildGitHubPat()],
    [FIXTURE_TOKENS.openAiLegacyKey, buildOpenAiLegacyKey()],
    [FIXTURE_TOKENS.openAiProjectKey, buildOpenAiProjectKey()],
    [FIXTURE_TOKENS.rsaPrivateKeyHeader, buildPemHeader('RSA ')],
    [FIXTURE_TOKENS.ecPrivateKeyHeader, buildPemHeader('EC ')],
    [FIXTURE_TOKENS.privateKeyHeader, buildPemHeader('')],
  ];
}

function expandFixturePlaceholders(value) {
  let expanded = String(value || '');
  for (const [token, replacement] of fixtureReplacements()) {
    expanded = expanded.split(token).join(replacement);
  }
  return expanded;
}

module.exports = {
  FIXTURE_TOKENS,
  buildAwsAccessKeyId,
  buildGitHubPat,
  buildOpenAiLegacyKey,
  buildOpenAiProjectKey,
  buildPemHeader,
  expandFixturePlaceholders,
};
