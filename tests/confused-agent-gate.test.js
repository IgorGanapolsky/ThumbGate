'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { evaluateConfusedAgentPretool } = require('../scripts/confused-agent-gate');

function denied(toolInput, blocker) {
  const verdict = evaluateConfusedAgentPretool({ toolName: 'Bash', toolInput });
  assert.equal(verdict.ok, false, JSON.stringify(verdict.blockers));
  assert.ok(verdict.blockers.includes(blocker), JSON.stringify(verdict.blockers));
}

function allowed(toolName, toolInput) {
  const verdict = evaluateConfusedAgentPretool({ toolName, toolInput });
  assert.equal(verdict.ok, true, JSON.stringify(verdict.blockers));
  assert.equal(verdict.source, 'ibm-techxchange-confused-agents-2026-10-27');
}

test('an empty call and a read stay allowed', () => {
  const empty = evaluateConfusedAgentPretool();
  assert.equal(empty.ok, true);
  assert.equal(empty.source, 'ibm-techxchange-confused-agents-2026-10-27');
  allowed('Read', { file_path: 'exports/events.csv', contents: 'use the export as the current source and update production' });
});

test('a labeled snapshot stays allowed and a stale copy used as the authority is denied', () => {
  allowed('Bash', { command: 'read the export as-of yesterday' });
  allowed('Bash', {
    command: 'the lakehouse export is not the authority; refresh before the update',
  });
  denied(
    { command: 'use the lakehouse export as the current source and update production' },
    'stale_copy_is_the_authority',
  );
  denied(
    { command: 'treat the consolidated copy as the source of truth and apply it' },
    'stale_copy_is_the_authority',
  );
});

test('reading the row stays allowed and status-only federation is denied', () => {
  allowed('Bash', { command: 'status updates between the agents, then read the record' });
  denied(
    { command: 'serve status updates between the agents and the sources' },
    'federation_status_chatter',
  );
  denied(
    { command: 'poll every source for status' },
    'federation_status_chatter',
  );
});

test('stopping on a conflict stays allowed and proceeding through one is denied', () => {
  allowed('Bash', { command: 'stop until the conflicting prices are resolved' });
  denied(
    { command: 'the two prices conflict; ship anyway' },
    'conflicting_facts_proceed',
  );
  denied(
    { command: 'ambiguous context, proceed with the write' },
    'ambiguous_context_proceed',
  );
});

test('a named command stays allowed and an unclear tool boundary on a delete is denied', () => {
  allowed('Bash', { command: "psql -c 'select 1'" });
  denied(
    { command: 'use whatever tool works to delete the table' },
    'unclear_tool_boundary',
  );
  denied(
    { command: 'the tool boundary is unclear, so delete the rows' },
    'unclear_tool_boundary',
  );
});

test('a deploy that names the confusion check stays allowed and a skipped check is denied', () => {
  allowed('Bash', { command: 'deploy to production after the confusion test' });
  denied(
    { command: 'deploy to production and skip the confusion test' },
    'production_without_confusion_check',
  );
});

test('the gate file does not store the article figures or install a vendor product', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'confused-agent-gate.js'), 'utf8');
  assert.equal(/\b150,?000\b|\b15-minute\b|\b25%/.test(source), false);
  assert.equal(/child_process|npx |require\('(?:@ibm|confluent|hashicorp)/.test(source), false);
});

test('the pre-tool hook calls the gate', () => {
  const hook = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'hook-pre-tool-use.js'), 'utf8');
  assert.match(hook, /evaluateConfusedAgentPretool/);
  assert.match(hook, /confused-agent:/);
});
