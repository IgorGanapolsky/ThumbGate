const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const bannedActiveNames = [
  'mcp-memory' + '-gateway',
  'rl' + 'hf',
  'rl' + 'hf-loop',
  'rl' + 'hf-feedback-loop',
];

const activeSurfaces = [
  'README.md',
  'adapters/chatgpt/INSTALL.md',
  'docs/chatgpt-gpt-instructions.md',
  'docs/gpt-store-submission.md',
  'docs/landing-page.html',
  'docs/marketing/product-hunt-launch.md',
  'docs/marketing/launch-content.md',
  'docs/marketing/reddit-seeding-posts.md',
  'docs/marketing/reddit-posts/r-claudeai.md',
  'docs/marketing/reddit-posts/r-locallama.md',
  'docs/marketing/reddit-posts/r-node.md',
  'docs/marketing/reddit-posts/r-webdev.md',
  'docs/marketing/show-hn.md',
  'public/index.html',
  'public/compare.html',
  'public/llm-context.md',
  'scripts/ralph-mode-ci.js',
];

test('active launch and GPT surfaces are ThumbGate-only', () => {
  for (const relativePath of activeSurfaces) {
    const text = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8').toLowerCase();

    for (const bannedName of bannedActiveNames) {
      assert.equal(
        text.includes(bannedName),
        false,
        `${relativePath} must not use ${bannedName} as an active ThumbGate surface`,
      );
    }
  }
});

test('canonical package metadata points only at ThumbGate', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

  assert.equal(packageJson.name, 'thumbgate');
  assert.equal(packageJson.repository.url, 'https://github.com/IgorGanapolsky/ThumbGate.git');
  assert.equal(packageJson.bugs.url, 'https://github.com/IgorGanapolsky/ThumbGate/issues');
  assert.equal(packageJson.homepage, 'https://thumbgate.ai');
});
