'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateConfidenceActiveFlag } = require('../scripts/confidence-active-flag');
const gates = require('../scripts/gates-engine');

function bash(command) {
  return { toolName: 'Bash', toolInput: { command }, command };
}

function edit(filePath, oldString, newString) {
  return {
    toolName: 'Edit',
    toolInput: { file_path: filePath, old_string: oldString, new_string: newString },
    command: '',
  };
}

function reason(view) {
  const result = evaluateConfidenceActiveFlag(view);
  return result && result.failureReason;
}

test('a client fallback of enabled is denied, and false is allowed', () => {
  assert.equal(
    reason(edit('src/checkout.js', '', 'confidence.getBooleanFlag("new-navbar", true);')),
    'fail_open_default',
  );
  assert.equal(
    reason(edit('src/checkout.js', '', 'confidence.resolveFlag("new-navbar", "enabled");')),
    'fail_open_default',
  );
  assert.equal(
    reason(edit('src/checkout.js', '', 'confidence.getBooleanFlag("new-navbar", false);')),
    null,
  );
});

test('an ACTIVE flag whose defaultValue is true is denied', () => {
  const active = '{"state":"ACTIVE","flagKey":"new-navbar","defaultValue":true}';
  assert.equal(reason(edit('flags/navbar.json', '', active)), 'fail_open_default');
  assert.equal(
    reason(edit('package.json', '', '{"defaultValue":true,"name":"widget"}')),
    null,
  );
});

test('a match-all rule above a narrower rule is denied', () => {
  const hidden = JSON.stringify({
    state: 'ACTIVE',
    flagKey: 'new-navbar',
    rules: [
      { segment: 'all', variant: 'enabled' },
      { segment: 'beta-users', variant: 'enabled', percent: 10 },
    ],
  });
  const ordered = JSON.stringify({
    state: 'ACTIVE',
    flagKey: 'new-navbar',
    rules: [
      { userIds: ['user-1'], variant: 'enabled' },
      { segment: 'beta-users', variant: 'enabled', percent: 10 },
      { segment: 'all', variant: 'disabled' },
    ],
  });
  assert.equal(reason(edit('flags/navbar.json', '', hidden)), 'catch_all_before_subset');
  assert.equal(reason(edit('flags/navbar.json', '', ordered)), null);
  assert.equal(
    reason(edit('flags/navbar.json', '', JSON.stringify({
      rules: [{ segment: 'all', variant: 'disabled' }],
    }))),
    null,
  );
});

test('a hand edit of a rollout assignment is denied, and a description edit is allowed', () => {
  const before = JSON.stringify({
    rules: [{ managedBy: 'ROLLOUT', assignmentSpec: { percent: 10, variant: 'enabled' }, description: 'canary' }],
  });
  const changed = JSON.stringify({
    rules: [{ managedBy: 'ROLLOUT', assignmentSpec: { percent: 40, variant: 'enabled' }, description: 'canary' }],
  });
  const described = JSON.stringify({
    rules: [{ managedBy: 'ROLLOUT', assignmentSpec: { percent: 10, variant: 'enabled' }, description: 'note' }],
  });
  assert.equal(reason(edit('flags/navbar.json', before, changed)), 'managed_rule_rewrite');
  assert.equal(reason(edit('flags/navbar.json', before, described)), null);
});

test('a flag key that encodes on/off or a ticket is denied', () => {
  assert.equal(
    reason(edit('flags/navbar.json', '', '{"flagKey":"new-navbar-enabled","state":"ACTIVE"}')),
    'config_in_flag_key',
  );
  assert.equal(
    reason(edit('flags/navbar.json', '', '{"flagKey":"JIRA-440","state":"ACTIVE"}')),
    'config_in_flag_key',
  );
  assert.equal(
    reason(bash('confidence flags create new-navbar-enabled')),
    'config_in_flag_key',
  );
  assert.equal(reason(bash('confidence flags create new-navbar')), null);
});

test('search text, echo, and comments are not flag writes', () => {
  assert.equal(reason(bash("rg 'getBooleanFlag(\"new-navbar\", true)' src")), null);
  assert.equal(reason(bash("echo 'getBooleanFlag(\"new-navbar\", true)'")), null);
  assert.equal(
    reason(edit('src/checkout.js', '', '// getBooleanFlag("new-navbar", true)\nconst ready = true;\n')),
    null,
  );
});

test('a quoted hash does not hide a bad flag key, and a heredoc is the file', () => {
  assert.equal(
    reason(bash("printf '%s\\n' '#'; confidence flags create new-navbar-enabled")),
    'config_in_flag_key',
  );
  const command = `cat > flags/navbar.json <<'EOF'
{"state":"ACTIVE","flagKey":"new-navbar-enabled"}
EOF`;
  assert.equal(reason(bash(command)), 'config_in_flag_key');
});

test('sudo and a shell -c still count, and a rollout above 10% uses the existing diode', () => {
  assert.equal(
    reason(bash('sudo -u ship confidence flags create JIRA-12')),
    'config_in_flag_key',
  );
  assert.equal(
    reason(bash('bash -c \'confidence.getBooleanFlag("new-navbar", true)\'')),
    'fail_open_default',
  );
  assert.equal(reason(bash('confidence rollout set --percent 50')), 'rollout_ceiling');
  assert.equal(reason(bash('confidence rollout set --percent 10')), null);
  assert.equal(reason(bash("rg 'confidence rollout set --percent 50' docs")), null);
  assert.equal(reason(bash('npx @spotify-confidence/cli rollout set --percent 50')), 'rollout_ceiling');
  assert.equal(reason(bash('npx @spotify-confidence/cli rollout set --percent 10')), null);
  assert.equal(
    reason(bash("rg 'npx @spotify-confidence/cli rollout set --percent 50' docs")),
    null,
  );
});

test('a partial edit is judged on the file after the replacement', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-confidence-'));
  const flagFile = path.join(dir, 'navbar.json');
  const clientFile = path.join(dir, 'checkout.js');
  fs.writeFileSync(flagFile, `${JSON.stringify({
    rules: [{ managedBy: 'ROLLOUT', assignmentSpec: { percent: 10, variant: 'enabled' }, description: 'canary' }],
  })}\n`);
  fs.writeFileSync(clientFile, 'confidence.getBooleanFlag("new-navbar", false);\n');
  try {
    assert.equal(reason(edit(flagFile, '"percent":10', '"percent":50')), 'managed_rule_rewrite');
    assert.equal(reason(edit(flagFile, 'canary', 'note')), null);
    assert.equal(reason(edit(clientFile, 'false', 'true')), 'fail_open_default');
    assert.equal(reason(edit(clientFile, 'new-navbar', 'new-checkout')), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runHardFloor denies the enabled client fallback', () => {
  const body = JSON.parse(gates.runHardFloor({
    tool_name: 'Edit',
    tool_input: {
      file_path: 'src/checkout.js',
      old_string: '',
      new_string: 'confidence.getBooleanFlag("new-navbar", true);',
    },
  }));
  assert.equal(body.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(body.hookSpecificOutput.permissionDecisionReason, /\[GATE:confidence-active-flag\]/);
  assert.match(body.hookSpecificOutput.permissionDecisionReason, /compiled default/);
});
