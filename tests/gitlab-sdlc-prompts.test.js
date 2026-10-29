'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { evaluateGitLabSdlcPrompts } = require('../scripts/gitlab-sdlc-prompts');
const gates = require('../scripts/gates-engine');

function bash(command) {
  return { toolName: 'Bash', toolInput: { command }, command };
}

function edit(filePath, text) {
  return {
    toolName: 'Edit',
    toolInput: { file_path: filePath, new_string: text, old_string: 'before' },
  };
}

test('a no-breaking-changes claim that drops a column, export, or config key is denied', () => {
  const column = evaluateGitLabSdlcPrompts(edit(
    'CHANGELOG.md',
    'No breaking changes.\nALTER TABLE users DROP COLUMN email;',
  ));
  assert.equal(column && column.failureReason, 'breaking_change_hidden');

  const removed = evaluateGitLabSdlcPrompts(edit(
    'src/pay.js',
    'This MR is backward compatible.\n- export function pay(id) {}',
  ));
  assert.equal(removed && removed.failureReason, 'breaking_change_hidden');

  const config = evaluateGitLabSdlcPrompts(bash(
    "gh pr merge 12 --body 'not a breaking change' --diff '- BILLING_MODE: live'",
  ));
  assert.equal(config && config.failureReason, 'breaking_change_hidden');
});

test('the claim alone, the drop alone, a search, and a comment are allowed', () => {
  assert.equal(evaluateGitLabSdlcPrompts(edit('CHANGELOG.md', 'No breaking changes.')), null);
  assert.equal(
    evaluateGitLabSdlcPrompts(edit('migrate.sql', 'ALTER TABLE users DROP COLUMN email;')),
    null,
  );
  assert.equal(
    evaluateGitLabSdlcPrompts(bash("rg 'No breaking changes' CHANGELOG.md")),
    null,
  );
  assert.equal(
    evaluateGitLabSdlcPrompts(bash("gh pr merge 12 --body 'No breaking changes' # DROP COLUMN email")),
    null,
  );
});

test('a quoted hash does not hide a drop that sits next to the claim', () => {
  const hidden = evaluateGitLabSdlcPrompts(bash(
    'gh pr merge 12 --body "No breaking changes # DROP COLUMN email"',
  ));
  assert.equal(hidden && hidden.failureReason, 'breaking_change_hidden');
});

test('a false-positive dismissal needs a comment', () => {
  const bare = evaluateGitLabSdlcPrompts(bash(
    'glab api --method PUT projects/1/vulnerabilities/9/dismiss -f dismissal_reason=false_positive',
  ));
  assert.equal(bare && bare.failureReason, 'finding_dismissed');

  const explained = evaluateGitLabSdlcPrompts(bash(
    "glab api --method PUT projects/1/vulnerabilities/9/dismiss -f dismissal_reason=false_positive --comment='reproduced only in the fixture'",
  ));
  assert.equal(explained, null);
  assert.equal(
    evaluateGitLabSdlcPrompts(edit('docs/review.md', 'Do not dismiss a real finding as a false positive.')),
    null,
  );
});

test('a test file that names the missing cases and only writes the happy path is denied', () => {
  const onlyHappy = [
    'Generate unit tests. Include edge cases, error conditions, boundary values, and invalid inputs.',
    "test('works', () => { assert.equal(1, 1); });",
  ].join('\n');
  const denied = evaluateGitLabSdlcPrompts(edit('tests/pay.test.js', onlyHappy));
  assert.equal(denied && denied.failureReason, 'happy_path_only');

  const covered = `${onlyHappy}\ntest('rejects invalid input', () => { assert.throws(() => pay(null)); });`;
  assert.equal(evaluateGitLabSdlcPrompts(edit('tests/pay.test.js', covered)), null);
  assert.equal(evaluateGitLabSdlcPrompts(edit('src/pay.js', onlyHappy)), null);
});

test('a pipeline rerun that pastes the error needs a cause, and a bare rerun is allowed', () => {
  assert.equal(evaluateGitLabSdlcPrompts(bash('gh run rerun 12345')), null);
  const pasted = evaluateGitLabSdlcPrompts(bash(
    'gh run rerun 12345 --log "Error: exit code 1"',
  ));
  assert.equal(pasted && pasted.failureReason, 'pipeline_rerun_without_cause');
  assert.equal(
    evaluateGitLabSdlcPrompts(bash(
      'gh run rerun 12345 --log "Error: exit code 1" # because the lockfile drifted',
    )).failureReason,
    'pipeline_rerun_without_cause',
  );
  assert.equal(
    evaluateGitLabSdlcPrompts(bash(
      'gh run rerun 12345 --log "Error: exit code 1 because the lockfile drifted"',
    )),
    null,
  );
  assert.equal(
    evaluateGitLabSdlcPrompts(bash(
      'echo "$(gh run rerun 12345 --log \'Error: exit code 1\')"',
    )).failureReason,
    'pipeline_rerun_without_cause',
  );
  assert.equal(
    evaluateGitLabSdlcPrompts(bash(
      "echo '$(gh run rerun 12345 --log \"Error: exit code 1\")'",
    )),
    null,
  );
});

test('a quoted fixture, a redirected printf, and a sentence comment stay on the action', () => {
  const own = fs.readFileSync(path.join(__dirname, 'gitlab-sdlc-prompts.test.js'), 'utf8');
  assert.equal(
    evaluateGitLabSdlcPrompts(edit('tests/gitlab-sdlc-prompts.test.js', own)),
    null,
  );
  assert.equal(
    evaluateGitLabSdlcPrompts(edit(
      'docs/gitlab.md',
      'Example of the deny:\n```\nNo breaking changes.\nDROP TABLE sessions;\n```\n',
    )),
    null,
  );
  assert.equal(
    evaluateGitLabSdlcPrompts(edit(
      'docs/gitlab.md',
      'No breaking changes.\nDROP TABLE sessions;',
    )).failureReason,
    'breaking_change_hidden',
  );
  assert.equal(
    evaluateGitLabSdlcPrompts(bash(
      "printf '%s\\n' 'No breaking changes.' 'DROP TABLE sessions;' > CHANGELOG.md",
    )).failureReason,
    'breaking_change_hidden',
  );
  assert.equal(
    evaluateGitLabSdlcPrompts(bash("printf '%s\\n' 'No breaking changes.'")),
    null,
  );
  assert.equal(
    evaluateGitLabSdlcPrompts(bash(
      "glab api --method PUT projects/1/vulnerabilities/9/dismiss -f dismissal_reason=false_positive --comment='This is only reachable in isolated test fixtures.'",
    )),
    null,
  );
  assert.equal(
    evaluateGitLabSdlcPrompts(bash(
      "glab api --method PUT projects/1/vulnerabilities/9/dismiss -f dismissal_reason=false_positive --comment='short'",
    )).failureReason,
    'finding_dismissed',
  );
});

test('the hard floor denies the hidden breaking change', () => {
  const body = JSON.parse(gates.runHardFloor({
    tool_name: 'Edit',
    tool_input: {
      file_path: 'CHANGELOG.md',
      old_string: 'before',
      new_string: 'No breaking changes.\nDROP TABLE sessions;',
    },
  }));
  assert.equal(body.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(body.hookSpecificOutput.permissionDecisionReason, /\[GATE:gitlab-sdlc-prompts\]/);
});
