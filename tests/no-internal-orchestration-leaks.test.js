'use strict';

// Refuses to let internal AI-orchestration paths land on main again.
//
// Why this exists: on 2026-06-06 a Reddit r/devops thread surfaced three
// public files that, together, looked like a bot-farmed vibe-coded operation:
//   - .claude/implementation-notes/2026-05-20-high-roi-items.md   (founder
//     sentiment + "$0 revenue" line)
//   - .claude/ralph/ATTEMPTS.md                                    ("Task 4:
//     ready-to-post for Reddit, HN, Discord")
//   - .github/workflows/social-engagement-hourly.yml               (hourly
//     cadence evidence)
// The .gitignore + .githooks/pre-commit guards catch local mistakes; this CI
// test is the last line of defense for force-pushes, GitHub-web edits, and
// branches that don't run the local hooks.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const FORBIDDEN_DIRS = [
  '.claude/implementation-notes',
  '.claude/ralph',
  'docs/marketing/reddit-posts',
  'docs/marketing/hn-posts',
  'docs/marketing/discord-posts',
];

const FORBIDDEN_FILE_PATTERNS = [
  /^\.github\/workflows\/ralph-.*\.ya?ml$/,
  /^\.github\/workflows\/social-engagement-.*\.ya?ml$/,
];

function listAllFiles(dir, base = dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listAllFiles(abs, base));
    } else if (entry.isFile()) {
      out.push(path.relative(base, abs));
    }
  }
  return out;
}

test('no internal-orchestration directories are tracked', () => {
  for (const dir of FORBIDDEN_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    const files = listAllFiles(abs, ROOT);
    assert.equal(
      files.length,
      0,
      `Internal-orchestration directory "${dir}" must not contain tracked files. ` +
        `Found: ${files.join(', ')}. ` +
        `See Reddit r/devops 2026-06-06 incident. ` +
        `Add to .gitignore and delete from the tree.`
    );
  }
});

test('no ralph-*/social-engagement-* GitHub workflows are tracked', () => {
  const workflowsDir = path.join(ROOT, '.github', 'workflows');
  if (!fs.existsSync(workflowsDir)) return;
  const offenders = fs
    .readdirSync(workflowsDir)
    .filter((name) =>
      FORBIDDEN_FILE_PATTERNS.some((pat) =>
        pat.test(`.github/workflows/${name}`)
      )
    );
  assert.deepEqual(
    offenders,
    [],
    `Forbidden workflow files present: ${offenders.join(', ')}. ` +
      `These reveal AI-orchestration cadence and were called out publicly on ` +
      `2026-06-06. Delete and rely on private CI.`
  );
});
