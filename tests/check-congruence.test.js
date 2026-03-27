const test = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('child_process');
const path = require('path');
const {
  collectLocalGitHubAboutErrors,
  compareGitHubAbout,
  loadGitHubAboutConfig,
  normalizeTopics,
} = require('../scripts/github-about');

const ROOT = path.join(__dirname, '..');

test('check-congruence exits 0 on current codebase', () => {
  const result = execSync('node scripts/check-congruence.js', { cwd: ROOT, encoding: 'utf-8' });
  assert.match(result, /Congruence check passed/);
  assert.match(result, /ThumbGate/);
  assert.match(result, /6 tech terms/);
  assert.match(result, /GitHub About source-of-truth verified/);
});

test('check-congruence verifies version, brand, tech terms, and disclaimer', () => {
  const output = execSync('node scripts/check-congruence.js', { cwd: ROOT, encoding: 'utf-8' });
  assert.match(output, /v\d+\.\d+\.\d+/);
  assert.match(output, /brand "ThumbGate"/);
});

test('GitHub About source-of-truth matches local public surfaces', () => {
  assert.deepEqual(collectLocalGitHubAboutErrors(ROOT), []);
});

test('GitHub About comparison normalizes topic order and flags real drift', () => {
  const about = loadGitHubAboutConfig(ROOT);

  assert.deepEqual(
    compareGitHubAbout(about, {
      description: about.description,
      homepageUrl: about.homepageUrl,
      topics: [...about.topics].reverse(),
    }, 'Live GitHub About'),
    []
  );

  const errors = compareGitHubAbout(about, {
    description: `${about.description} Extra drift`,
    homepageUrl: 'https://example.com',
    topics: normalizeTopics(['thumbgate', 'cursor']),
  }, 'Live GitHub About');

  assert.match(errors.join('\n'), /description mismatch/);
  assert.match(errors.join('\n'), /homepage mismatch/);
  assert.match(errors.join('\n'), /topics mismatch/);
});
