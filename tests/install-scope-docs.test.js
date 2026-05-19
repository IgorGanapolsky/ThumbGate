'use strict';

/**
 * install-scope-docs.test.js
 *
 * Regression guard for the install-scope documentation gap.
 *
 * Background: prior to 2026-05-18 neither the README nor any thumbgate.ai
 * page (index.html, guide.html, learn/*.html) explained that ThumbGate
 * supports two install scopes (machine-wide vs per-project) and that the
 * choice determines where lessons + dashboard live. Users had no way to
 * make an informed choice. CLAUDE.md "honesty protocol" + the AI agent
 * governance best-practices research called this a real DX gap.
 *
 * This suite pins the documentation so it cannot silently disappear:
 * every user-facing surface that talks about installing must also talk
 * about scope. If you remove the scope section from any of these files
 * without replacing it, this suite fails.
 */

const fs = require('node:fs');
const path = require('node:path');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const GUIDE_HTML = fs.readFileSync(path.join(ROOT, 'public', 'guide.html'), 'utf8');
const CLI_JS = fs.readFileSync(path.join(ROOT, 'bin', 'cli.js'), 'utf8');

const SCOPE_KEYWORDS = [
  /machine[- ]wide/i,
  /per[- ]project/i,
  /--project/,
];

const SHARED_DASHBOARD_PHRASE = /shared dashboard|one shared dashboard|across every repo/i;
const ISOLATED_DASHBOARD_PHRASE = /separate dashboard|isolated|per[- ]repo dashboard/i;
const LESSON_PATH_PHRASE = /\.claude\/memory\/feedback\//;

describe('install-scope documentation: README.md', () => {
  test('contains the dedicated "Install scope" section', () => {
    assert.match(
      README,
      /###\s+Install scope:?\s+machine-wide vs per-project/i,
      'README must include a dedicated section heading explaining install scope'
    );
  });

  test('mentions every scope keyword', () => {
    for (const re of SCOPE_KEYWORDS) {
      assert.match(README, re, `README must mention pattern ${re}`);
    }
  });

  test('contrasts shared vs isolated dashboards', () => {
    assert.match(README, SHARED_DASHBOARD_PHRASE, 'README must describe the shared-dashboard outcome');
    assert.match(README, ISOLATED_DASHBOARD_PHRASE, 'README must describe the isolated-dashboard outcome');
  });

  test('shows where the lesson DB lives so users can find it', () => {
    assert.match(README, LESSON_PATH_PHRASE, 'README must reference the .claude/memory/feedback/ lesson DB path');
  });
});

describe('install-scope documentation: public/guide.html', () => {
  test('contains the install-scope subsection', () => {
    assert.match(
      GUIDE_HTML,
      /<h3[^>]*>\s*Install scope:?\s+machine-wide vs per-project\s*<\/h3>/i,
      'guide.html must include an <h3> for install scope'
    );
  });

  test('renders the scope comparison table with both rows', () => {
    assert.match(GUIDE_HTML, /<table[\s\S]+?Machine-wide[\s\S]+?Per-project[\s\S]+?<\/table>/i,
      'guide.html must show a comparison table with both scope rows');
  });

  test('mentions --project flag and machine-wide default', () => {
    assert.match(GUIDE_HTML, /--project/, 'guide.html must mention the --project flag');
    assert.match(GUIDE_HTML, /default/i, 'guide.html must mark which scope is the default');
  });

  test('warns that per-project lesson DB must stay gitignored', () => {
    assert.match(
      GUIDE_HTML,
      /gitignored|gitignore/i,
      'guide.html must warn users about gitignore for per-project lesson DB'
    );
  });
});

describe('install-scope documentation: bin/cli.js help output', () => {
  test('install-mcp help line documents both scopes', () => {
    assert.match(CLI_JS, /machine-wide/i, 'CLI help must mention machine-wide scope');
    assert.match(CLI_JS, /per-repo|per-project/i, 'CLI help must mention per-repo/per-project scope');
    assert.match(CLI_JS, /--project: per-repo|--project.*per-repo|--project.*per-project/i,
      'CLI help must associate --project with per-repo scope');
    assert.match(CLI_JS, /--no-hooks/, 'CLI help must mention the --no-hooks opt-out');
  });
});
