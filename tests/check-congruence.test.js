const test = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('child_process');
const path = require('path');
const {
  collectLocalGitHubAboutErrors,
  compareGitHubAbout,
  loadGitHubAboutConfig,
  MAX_GITHUB_DESCRIPTION_LENGTH,
  VERIFY_ATTEMPTS_ENV,
  VERIFY_DELAY_MS_ENV,
  normalizeTopics,
  verifyLiveGitHubAbout,
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

test('GitHub About config keeps a rich landing description and a valid GitHub description', () => {
  const about = loadGitHubAboutConfig(ROOT);
  assert.match(about.metaDescription, /👍/u);
  assert.match(about.metaDescription, /👎/u);
  assert.match(about.metaDescription, /thumbs up/i);
  assert.match(about.metaDescription, /thumbs down/i);
  assert.match(about.metaDescription, /history-aware lessons/i);
  assert.match(about.metaDescription, /shared lessons and org visibility/i);
  assert.match(about.githubDescription, /agent governance/i);
  assert.ok(about.githubDescription.length <= MAX_GITHUB_DESCRIPTION_LENGTH);
});

test('README commercial copy stays aligned with current Pro and Team packaging', () => {
  const readme = execSync('sed -n \'1,320p\' README.md', { cwd: ROOT, encoding: 'utf-8' });
  assert.match(readme, /\$19\/mo or \$149\/yr/);
  assert.match(readme, /\$99\/seat\/mo/);
  assert.match(readme, /shared hosted lesson DB/i);
  assert.match(readme, /org dashboard/i);
  assert.match(readme, /history-aware/i);
  assert.match(readme, /feedback session|open_feedback_session|append_feedback_context|finalize_feedback_session/i);
  assert.match(readme, /3 daily feedback captures/i);
  assert.match(readme, /5 daily lesson searches/i);
  assert.doesNotMatch(readme, /\$12\/seat\/mo/i);
  assert.doesNotMatch(readme, /shared team DB/i);
  assert.doesNotMatch(readme, /\/mo\$19/i);
});

test('launch content commercial copy stays aligned with the current free and Pro packaging', () => {
  const launchContent = execSync('sed -n \'1,260p\' docs/marketing/launch-content.md', { cwd: ROOT, encoding: 'utf-8' });

  assert.match(launchContent, /Pro \(\$19\/mo or \$149\/yr\)/);
  assert.match(launchContent, /No cloud account required/i);
  assert.doesNotMatch(launchContent, /Fully free and unlimited/i);
  assert.doesNotMatch(launchContent, /No limits\./i);
  assert.doesNotMatch(launchContent, /Cloud sync \(optional\)/i);
});

test('launch content uses tracked landing links for community distribution', () => {
  const launchContent = execSync('sed -n \'1,260p\' docs/marketing/launch-content.md', { cwd: ROOT, encoding: 'utf-8' });

  assert.match(launchContent, /thumbgate-production\.up\.railway\.app\/\?utm_source=reddit/i);
  assert.match(launchContent, /thumbgate-production\.up\.railway\.app\/\?utm_source=hackernews/i);
  assert.match(launchContent, /thumbgate-production\.up\.railway\.app\/\?utm_source=x/i);
  assert.doesNotMatch(launchContent, /buy\.stripe\.com/i);
});

test('GitHub About comparison normalizes topic order and flags real drift', () => {
  const about = loadGitHubAboutConfig(ROOT);

  assert.deepEqual(
    compareGitHubAbout(about, {
      description: about.githubDescription,
      homepageUrl: about.homepageUrl,
      topics: [...about.topics].reverse(),
    }, 'Live GitHub About'),
    []
  );

  const errors = compareGitHubAbout(about, {
    description: `${about.githubDescription} Extra drift`,
    homepageUrl: 'https://example.com',
    topics: normalizeTopics(['thumbgate', 'cursor']),
  }, 'Live GitHub About');

  assert.match(errors.join('\n'), /description mismatch/);
  assert.match(errors.join('\n'), /homepage mismatch/);
  assert.match(errors.join('\n'), /topics mismatch/);
});

test('verifyLiveGitHubAbout retries until eventual consistency resolves', async () => {
  const about = loadGitHubAboutConfig(ROOT);
  const fetchCalls = [];
  const sleepCalls = [];
  let attempt = 0;

  const result = await verifyLiveGitHubAbout({
    expected: about,
    attempts: 4,
    delayMs: 25,
    fetcher: async () => {
      fetchCalls.push(attempt);
      attempt += 1;
      if (attempt < 3) {
        return {
          description: `${about.githubDescription} drift`,
          homepageUrl: about.homepageUrl,
          topics: about.topics,
        };
      }
      return {
        description: about.githubDescription,
        homepageUrl: about.homepageUrl,
        topics: about.topics,
      };
    },
    sleep: async (delayMs) => {
      sleepCalls.push(delayMs);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.attemptsUsed, 3);
  assert.deepEqual(result.errors, []);
  assert.equal(fetchCalls.length, 3);
  assert.deepEqual(sleepCalls, [25, 50]);
});

test('verifyLiveGitHubAbout returns final drift after exhausting retries', async () => {
  const about = loadGitHubAboutConfig(ROOT);
  const sleepCalls = [];

  const result = await verifyLiveGitHubAbout({
    expected: about,
    attempts: 3,
    delayMs: 10,
    fetcher: async () => ({
      description: `${about.githubDescription} drift`,
      homepageUrl: 'https://example.com',
      topics: ['thumbgate'],
    }),
    sleep: async (delayMs) => {
      sleepCalls.push(delayMs);
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.attemptsUsed, 3);
  assert.match(result.errors.join('\n'), /description mismatch/);
  assert.match(result.errors.join('\n'), /homepage mismatch/);
  assert.match(result.errors.join('\n'), /topics mismatch/);
  assert.deepEqual(sleepCalls, [10, 20]);
});

test('verifyLiveGitHubAbout honors environment retry overrides', async () => {
  const about = loadGitHubAboutConfig(ROOT);
  const originalAttempts = process.env[VERIFY_ATTEMPTS_ENV];
  const originalDelay = process.env[VERIFY_DELAY_MS_ENV];
  const sleepCalls = [];
  let fetchCalls = 0;

  process.env[VERIFY_ATTEMPTS_ENV] = '4';
  process.env[VERIFY_DELAY_MS_ENV] = '15';

  try {
    const result = await verifyLiveGitHubAbout({
      expected: about,
      fetcher: async () => {
        fetchCalls += 1;
        return {
          description: `${about.githubDescription} drift`,
          homepageUrl: about.homepageUrl,
          topics: about.topics,
        };
      },
      sleep: async (delayMs) => {
        sleepCalls.push(delayMs);
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.attemptsUsed, 4);
    assert.equal(fetchCalls, 4);
    assert.deepEqual(sleepCalls, [15, 30, 45]);
  } finally {
    if (originalAttempts === undefined) {
      delete process.env[VERIFY_ATTEMPTS_ENV];
    } else {
      process.env[VERIFY_ATTEMPTS_ENV] = originalAttempts;
    }
    if (originalDelay === undefined) {
      delete process.env[VERIFY_DELAY_MS_ENV];
    } else {
      process.env[VERIFY_DELAY_MS_ENV] = originalDelay;
    }
  }
});
