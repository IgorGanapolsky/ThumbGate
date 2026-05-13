#!/usr/bin/env node
'use strict';

/**
 * audit-pr-bot-contamination.js — Fail CI fast when a PR contains commits
 * authored by a bare-identity bot (`actions@github.com`) that drop unrelated
 * files onto a feature branch.
 *
 * Why this exists:
 * - PR #1910 (a 21-line `/go/teams` redirector fix) got contaminated by a
 *   693-line Python file (`scripts/feedback_quality_eval.py`) committed by
 *   `GitHub Actions <actions@github.com>`. SonarCloud's "≥80% coverage on new
 *   code" gate then failed the entire PR for ~12 minutes per cycle while the
 *   Python file dragged coverage to 9%.
 * - The bare `actions@github.com` identity is the one GitHub Actions uses
 *   when an automation runs `git commit` without first running `git config
 *   user.email`. The standard `github-actions[bot]` bot uses
 *   `41898282+github-actions[bot]@users.noreply.github.com`. Seeing the bare
 *   identity on a feature branch is a strong signal that an off-script
 *   automation pushed without identity hygiene.
 *
 * What it checks (on every pull_request synchronize):
 *   1. List all commits on this PR via the GitHub REST API.
 *   2. For each commit, fetch author + files-changed counts.
 *   3. Fail (exit 1) if any commit:
 *        - is authored by `actions@github.com` (bare identity, NOT
 *          `github-actions[bot]@...`), AND
 *        - adds > LARGE_ADD_THRESHOLD lines of NEW files (additions, not
 *          modifications).
 *   4. On failure: print a structured report; the workflow logs + sets a
 *      check status of failure.
 *
 * The script is read-only — no commits, no pushes, no PR comments. CI
 * surfaces the failure; humans decide whether to revert the contaminating
 * commit.
 *
 * Usage (CI):
 *   GITHUB_REPOSITORY=owner/repo PR_NUMBER=1910 GH_TOKEN=$GITHUB_TOKEN \
 *     node scripts/audit-pr-bot-contamination.js
 *
 * Env:
 *   GITHUB_REPOSITORY  required, e.g. "IgorGanapolsky/ThumbGate"
 *   PR_NUMBER          required, integer
 *   GH_TOKEN           required, GITHUB_TOKEN with `pull-requests: read`
 *   LARGE_ADD_THRESHOLD  optional, default 100 (lines of net addition)
 *   ALLOW_BARE_BOT_AUTHOR  optional, when set to "1" downgrades failure to
 *                          warning (useful for migration / opt-in rollout)
 */

const path = require('node:path');

const REPO = process.env.GITHUB_REPOSITORY || '';
const PR_NUMBER = Number(process.env.PR_NUMBER || '0');
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const LARGE_ADD_THRESHOLD = Number(process.env.LARGE_ADD_THRESHOLD || '100');
const ALLOW_BARE_BOT_AUTHOR = process.env.ALLOW_BARE_BOT_AUTHOR === '1';

// The bare GitHub Actions runner identity. Standard `github-actions[bot]`
// commits use `41898282+github-actions[bot]@users.noreply.github.com` — that
// form is allowed because it comes from documented bot workflows. The bare
// form below is the off-script-automation smell we're guarding against.
const BARE_BOT_EMAIL = 'actions@github.com';

// Workflows that legitimately push commits as `github-actions[bot]` to PR
// branches (e.g. dependabot-automerge). Commits whose author email matches
// the bot pattern AND whose committer matches one of these allowlisted
// patterns are allowed past the gate. Conservative — only widen when a
// concrete recurring legitimate use case appears.
const ALLOWED_BOT_BRANCH_PREFIXES = [
  'auto/', 'agent/', 'claude/', 'codex/', 'dependabot/', 'renovate/',
];

async function ghFetch(urlPath) {
  const url = urlPath.startsWith('https://') ? urlPath : `https://api.github.com${urlPath}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${res.status} ${urlPath}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function listCommits(repo, prNumber) {
  // Pagination handled — bounded at 30 commits per page, up to 250 to bound
  // memory on long-lived branches.
  let all = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await ghFetch(`/repos/${repo}/pulls/${prNumber}/commits?per_page=30&page=${page}`);
    all = all.concat(batch);
    if (batch.length < 30) break;
  }
  return all;
}

async function getCommitDetail(repo, sha) {
  return ghFetch(`/repos/${repo}/commits/${sha}`);
}

function isBareBotAuthor(commit) {
  const email = (commit && commit.commit && commit.commit.author && commit.commit.author.email) || '';
  return email.toLowerCase() === BARE_BOT_EMAIL.toLowerCase();
}

function totalAdditions(commitDetail) {
  const files = (commitDetail && commitDetail.files) || [];
  return files.reduce((sum, f) => sum + (Number(f.additions) || 0), 0);
}

function newFilesAdded(commitDetail) {
  const files = (commitDetail && commitDetail.files) || [];
  return files.filter((f) => f.status === 'added').map((f) => `${f.filename} (+${f.additions})`);
}

async function main() {
  if (!REPO || !PR_NUMBER || !TOKEN) {
    console.error('Required env: GITHUB_REPOSITORY, PR_NUMBER, GH_TOKEN');
    process.exitCode = 2;
    return;
  }
  console.log(`audit-pr-bot-contamination: repo=${REPO} pr=#${PR_NUMBER} threshold=${LARGE_ADD_THRESHOLD}`);

  const pr = await ghFetch(`/repos/${REPO}/pulls/${PR_NUMBER}`);
  const branch = pr.head && pr.head.ref;
  console.log(`  head branch: ${branch}`);

  // Branches owned by automation (auto/*, agent/*, claude/*, codex/*) are
  // expected to carry bot commits. Skip the audit cleanly on those.
  const isAutomationBranch = ALLOWED_BOT_BRANCH_PREFIXES.some((p) => branch && branch.startsWith(p));
  if (isAutomationBranch) {
    console.log(`  ✓ branch ${branch} is an automation-owned branch; skipping audit`);
    return;
  }

  const commits = await listCommits(REPO, PR_NUMBER);
  console.log(`  inspecting ${commits.length} commit(s)`);

  const violations = [];
  for (const c of commits) {
    if (!isBareBotAuthor(c)) continue;
    const detail = await getCommitDetail(REPO, c.sha);
    const additions = totalAdditions(detail);
    const newFiles = newFilesAdded(detail);
    if (additions <= LARGE_ADD_THRESHOLD && newFiles.length === 0) {
      // Small/no-new-file commit by bare bot — likely a merge or trivial fix.
      // Surface as info, not violation.
      console.log(`  · ${c.sha.slice(0, 8)} bare-bot-authored (${additions} lines, 0 new files) — tolerated`);
      continue;
    }
    violations.push({
      sha: c.sha,
      message: ((c.commit && c.commit.message) || '').split('\n')[0],
      authorEmail: c.commit && c.commit.author && c.commit.author.email,
      additions,
      newFiles,
    });
  }

  if (violations.length === 0) {
    console.log('\n✓ No contamination detected.');
    return;
  }

  console.log('\n✗ Bot-contamination detected:');
  for (const v of violations) {
    console.log(`  - ${v.sha.slice(0, 8)} "${v.message}"`);
    console.log(`      author=${v.authorEmail}  additions=+${v.additions}`);
    if (v.newFiles.length) console.log(`      new files: ${v.newFiles.slice(0, 5).join(', ')}${v.newFiles.length > 5 ? ` (+${v.newFiles.length - 5} more)` : ''}`);
  }
  console.log('\nWhat this means:');
  console.log(`  These commits were authored as <${BARE_BOT_EMAIL}> (the bare GitHub Actions`);
  console.log('  identity, NOT the registered github-actions[bot]). They added > '
    + `${LARGE_ADD_THRESHOLD} lines of new files on a non-automation branch, which is the`);
  console.log('  contamination pattern this guard exists to catch.');
  console.log('\nHow to fix:');
  console.log('  1. git revert <sha> (or rebase to drop the commit)');
  console.log('  2. Re-push the feature branch');
  console.log('  3. If the contaminating change is intentional, open it as a SEPARATE PR.');

  if (ALLOW_BARE_BOT_AUTHOR) {
    console.log('\n  ALLOW_BARE_BOT_AUTHOR=1 — downgrading to warning, not failing.');
    return;
  }
  process.exitCode = 1;
}

const isMain = path.resolve(process.argv[1] || '') === path.resolve(__filename);
if (isMain) {
  main().catch((err) => {
    console.error('FATAL:', err && err.message ? err.message : err);
    process.exitCode = 2;
  });
}

module.exports = { main, isBareBotAuthor, totalAdditions, newFilesAdded };
