'use strict';

/**
 * Pins the "never bypass branch protection" directive into every agent-facing directive file.
 *
 * A rule that lives only in prose can be deleted by the next agent that finds it inconvenient.
 * On 2026-07-10 an agent approved PR #2768 with the owner's credentials to satisfy
 * `require_code_owner_reviews`, and watched `mergeStateStatus` flip BLOCKED -> CLEAN. The
 * control exists so a human reads the diff. Green CI is not a substitute.
 *
 * If you are here because this test failed: do not delete the assertion. Restore the directive.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DIRECTIVE_FILES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'];

// Every agent-facing directive file must carry the prohibition verbatim enough to be unmissable.
const REQUIRED_PHRASES = [
  /NEVER approve a pull request/i,
  /NEVER use `--admin`, `--force`, or an owner credential/i,
  /report the blocker with evidence, and stop/i,
];

for (const file of DIRECTIVE_FILES) {
  test(`${file} carries the never-bypass-branch-protection directive`, () => {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(
      text,
      /NEVER Bypass Branch Protection \(ABSOLUTE\)/,
      `${file} must contain the ABSOLUTE branch-protection section`,
    );
    for (const phrase of REQUIRED_PHRASES) {
      assert.match(text, phrase, `${file} must state: ${phrase}`);
    }
  });

  test(`${file} explains WHY the directive exists`, () => {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    // A rule without its incident is a rule someone deletes. Keep the 2026-07-10 provenance.
    assert.match(text, /2026-07-10/, `${file} must retain the incident date`);
    assert.match(text, /#2768/, `${file} must retain the PR that was improperly approved`);
  });
}

test('AGENTS.md bounds the autonomy directive with the branch-protection limit', () => {
  const text = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  // "Never leave a PR open when it can be merged" is the instruction that produced the bypass.
  // It must be explicitly bounded wherever it appears.
  assert.match(text, /Never leave a PR open when it can be merged/);
  assert.match(
    text,
    /autonomy stops at branch protection/i,
    'the autonomy directive must be explicitly bounded by branch protection',
  );
});
