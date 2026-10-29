'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateEmailStrategyPretool,
  evaluateJellyfishClaudeCodeBillSteal,
} = require('../scripts/email-strategy-pretool');

test('a normal tool call runs all six strategies and is allowed', () => {
  const verdict = evaluateEmailStrategyPretool({
    toolName: 'Bash',
    toolInput: { command: 'ls scripts' },
  });
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.blockers, []);
  assert.deepEqual(verdict.called, [
    'evaluateGrokBotMemoryImportSteal',
    'evaluateSupabaseAgentDatabaseSteal',
    'evaluateGenie4WorldModelCounterfactualSteal',
    'evaluateIbmAgentIdentityAndControlSteal',
    'evaluateJellyfishClaudeCodeBillSteal',
    'evaluateFiveFactorEvalDataCurationSteal',
  ]);
});

test('Jellyfish math is the strategy from the $252 note', () => {
  const row = evaluateJellyfishClaudeCodeBillSteal({ developerCount: 2 });
  assert.equal(row.ok, true);
  assert.equal(row.monthlyTokenWasteSavedPerDevUsd, 105.84);
  assert.equal(row.developerCount, 2);
});

test('a raw secret in the tool payload is denied', () => {
  const verdict = evaluateEmailStrategyPretool({
    toolName: 'Bash',
    toolInput: { command: 'echo sk_live_example' },
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.blockers.includes('raw_secret_detected_in_memory_import_pack'));
});

test('DROP DATABASE is denied as an unbounded transition', () => {
  const verdict = evaluateEmailStrategyPretool({
    toolName: 'Bash',
    toolInput: { command: 'psql -c "DROP DATABASE prod"' },
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.blockers.includes('genie4_world_model_irreversible_state_transition'));
  assert.ok(verdict.blockers.includes('genie4_world_model_unbounded_blast_radius'));
});

test('production DDL without an ephemeral branch is denied', () => {
  const verdict = evaluateEmailStrategyPretool({
    toolName: 'Bash',
    toolInput: { command: 'psql production -c "ALTER TABLE public.users ADD COLUMN x int"' },
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.blockers.includes('supabase_agent_ddl_on_production_without_ephemeral_branch'));
});

test('the same DDL on an ephemeral branch is allowed', () => {
  const verdict = evaluateEmailStrategyPretool({
    toolName: 'Bash',
    toolInput: { command: 'psql production -c "ALTER TABLE public.users ADD COLUMN x int" -- ephemeral branch' },
  });
  assert.equal(verdict.ok, true);
});

test('a service_role key and disabled RLS are denied', () => {
  const verdict = evaluateEmailStrategyPretool({
    toolName: 'Write',
    toolInput: { contents: 'const key = service_role; DISABLE ROW LEVEL SECURITY' },
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.blockers.includes('supabase_service_role_key_exposed_to_agent_client'));
  assert.ok(verdict.blockers.includes('supabase_public_table_missing_row_level_security'));
});

test('assume-role without a bound principal is denied', () => {
  const verdict = evaluateEmailStrategyPretool({
    toolName: 'Bash',
    toolInput: { command: 'aws sts assume-role' },
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.blockers.includes('frontier_agent_privilege_escalation_blocked'));
  assert.ok(verdict.blockers.includes('missing_delegated_human_principal_binding'));
});
