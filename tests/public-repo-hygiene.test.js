'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function gitLsFiles(patterns = []) {
  return execFileSync('git', ['ls-files', ...patterns], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
  }).split('\n').filter(Boolean);
}

test('public repo excludes agent scratchpads and local runtime state', () => {
  const tracked = gitLsFiles([
    '.claude/implementation-notes/*',
    '.claude/ralph/*',
    '.claude/memory/feedback/*',
    '.claude/*.lock',
  ]).filter((file) => fs.existsSync(path.join(PROJECT_ROOT, file)));

  const allowed = new Set(['.claude/memory/feedback/.gitkeep']);
  const leaked = tracked.filter((file) => !allowed.has(file));
  assert.deepEqual(leaked, [], `tracked private/operator artifacts must be removed: ${leaked.join(', ')}`);
});

test('public repo does not ship the retired social-engagement workflow', () => {
  assert.equal(
    fs.existsSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'social-engagement-hourly.yml')),
    false,
    'public scheduled/manual social-engagement workflow exposes growth automation and should stay private',
  );
});

test('public repo blocks reputation-damaging internal scratchpad phrases', () => {
  const files = gitLsFiles();
  const blocked = [
    /CEO frustrated with months of engineering and \$0 revenue/i,
    /Task 4:\s*High-ROI Content Package/i,
    /Draft ready-to-post content for Reddit, HN, and Discord/i,
  ];
  const hits = [];

  for (const file of files) {
    if (file === 'tests/public-repo-hygiene.test.js') continue;
    const abs = path.join(PROJECT_ROOT, file);
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) continue;
    let text = '';
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    for (const pattern of blocked) {
      if (pattern.test(text)) hits.push(`${file}: ${pattern}`);
    }
  }

  assert.deepEqual(hits, [], `public repo contains internal scratchpad phrasing: ${hits.join('; ')}`);
});
