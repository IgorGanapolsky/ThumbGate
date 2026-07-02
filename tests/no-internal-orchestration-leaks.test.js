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
  'docs/marketing',
  // 2026-07-02: internal operator artifacts — generated reports (some naming
  // third parties), local proof artifacts, and session memory logs must never
  // be tracked in the public tree. Regenerate locally; keep out of git.
  'reports',
  'proof',
  'memory',
];

const FORBIDDEN_FILE_PATTERNS = [
  /^\.github\/workflows\/ralph-.*\.ya?ml$/,
  /^\.github\/workflows\/social-engagement-.*\.ya?ml$/,
];

// Root-level marketing/launch-theater markdown — read as vibe-coded AI hype.
// Second wave embarrassment after the initial Reddit thread.
const FORBIDDEN_ROOT_FILES = new Set([
  'LAUNCH.md',
  'LAUNCH_NOW.md',
  'LAUNCH_POSTS.md',
  'FIRST_CUSTOMER_BATTLE_PLAN.md',
  'ALL_ENHANCEMENTS_COMPLETE.md',
  'TEST_EVIDENCE_E2E_HYBRID_CLAW.md',
]);
const FORBIDDEN_ROOT_PATTERNS = [
  /^.+_BATTLE_PLAN\.md$/,
  /^ALL_ENHANCEMENTS.*\.md$/,
  /^TEST_EVIDENCE_.*\.md$/,
  /^LAUNCH_.*\.md$/,
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
  // Use `git ls-files` so that locally-gitignored scratchpads (e.g. a
  // dev's `.claude/implementation-notes/foo.md`) don't trip the assertion.
  // The test is about the public tree, not the local working copy.
  let tracked = '';
  try {
    tracked = require('node:child_process')
      .execSync('git ls-files', { cwd: ROOT })
      .toString();
  } catch {
    /* not a git checkout — fall back to fs walk */
    for (const dir of FORBIDDEN_DIRS) {
      const abs = path.join(ROOT, dir);
      if (!fs.existsSync(abs)) continue;
      const files = listAllFiles(abs, ROOT);
      assert.equal(files.length, 0, `Internal-orchestration directory "${dir}" must not contain files. Found: ${files.join(', ')}.`);
    }
    return;
  }
  const trackedFiles = tracked.split('\n').filter(Boolean);
  for (const dir of FORBIDDEN_DIRS) {
    const offenders = trackedFiles.filter((f) => f.startsWith(dir + '/'));
    assert.deepEqual(
      offenders,
      [],
      `Internal-orchestration directory "${dir}" must not contain tracked files. ` +
        `Found: ${offenders.join(', ')}. ` +
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

test('no marketing/launch-theater markdown is tracked at repo root', () => {
  const offenders = fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
    .filter(
      (name) =>
        FORBIDDEN_ROOT_FILES.has(name) ||
        FORBIDDEN_ROOT_PATTERNS.some((pat) => pat.test(name))
    );
  assert.deepEqual(
    offenders,
    [],
    `Marketing/launch-theater markdown found at repo root: ${offenders.join(', ')}. ` +
      `These read as vibe-coded AI output and damage public credibility. ` +
      `If a real launch/runbook is needed, keep it private or under docs/runbooks/ ` +
      `with a sober, dated, evidence-grounded format.`
  );
});
