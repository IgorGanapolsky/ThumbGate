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
  assert.match(output, /GitHub About source-of-truth verified/);
});

test('GitHub About source-of-truth matches local public surfaces', () => {
  assert.deepEqual(collectLocalGitHubAboutErrors(ROOT), []);
});

test('GitHub About description highlights both thumbs-up and thumbs-down feedback', () => {
  const about = loadGitHubAboutConfig(ROOT);
  assert.match(about.description, /👍/u);
  assert.match(about.description, /👎/u);
  assert.match(about.description, /thumbs up/i);
  assert.match(about.description, /thumbs down/i);
  assert.match(about.description, /history-aware lessons/i);
  assert.match(about.description, /shared lessons and org visibility/i);
});

test('README commercial copy stays aligned with current Pro and Team packaging', () => {
  const readme = execSync('sed -n \'1,320p\' README.md', { cwd: ROOT, encoding: 'utf-8' });
  assert.match(readme, /\$19\/mo or \$149\/yr/);
  assert.match(readme, /\$12\/seat\/mo/);
  assert.match(readme, /shared hosted lesson DB/i);
  assert.match(readme, /org dashboard/i);
  assert.match(readme, /history-aware/i);
  assert.match(readme, /feedback session|open_feedback_session|append_feedback_context|finalize_feedback_session/i);
  assert.match(readme, /5 daily feedback captures/i);
  assert.match(readme, /10 daily lesson searches/i);
  assert.doesNotMatch(readme, /unlimited captures/i);
  assert.doesNotMatch(readme, /shared team DB/i);
  assert.doesNotMatch(readme, /\/mo\$19/i);
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
