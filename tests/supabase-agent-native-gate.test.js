'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { evaluateSupabaseAgentNativePretool } = require('../scripts/supabase-agent-native-gate');

function denied(toolInput, blocker) {
  const verdict = evaluateSupabaseAgentNativePretool({ toolName: 'Bash', toolInput });
  assert.equal(verdict.ok, false, JSON.stringify(verdict.blockers));
  assert.ok(verdict.blockers.includes(blocker), JSON.stringify(verdict.blockers));
  return verdict;
}

function allowed(toolName, toolInput) {
  const verdict = evaluateSupabaseAgentNativePretool({ toolName, toolInput });
  assert.equal(verdict.ok, true, JSON.stringify(verdict.blockers));
  assert.equal(verdict.source, 'latent-space-supabase-2026-10-29');
}

test('an empty call and a read stay allowed', () => {
  const empty = evaluateSupabaseAgentNativePretool();
  assert.equal(empty.ok, true);
  assert.equal(empty.source, 'latent-space-supabase-2026-10-29');
  allowed('Read', { file_path: 'supabase/migrations/001_init.sql' });
});

test('one declarative schema file stays allowed', () => {
  allowed('Read', { file_path: 'schemas/public.sql' });
  allowed('Bash', { command: 'cat schemas/public.sql' });
  allowed('Bash', {
    command: 'read schemas/public.sql instead of parsing all historical migrations',
  });
  allowed('Write', {
    file_path: 'supabase/migrations/20261029140000_users.sql',
    contents: 'create table public.users (id uuid primary key);',
  });
});

test('rebuilding the schema from the migration chain is denied', () => {
  denied(
    { command: 'parse all historical migrations to figure out the table shape' },
    'schema_rebuild_from_migration_chain',
  );
  denied(
    { command: 'cat supabase/migrations/*.sql' },
    'schema_rebuild_from_migration_chain',
  );
  denied(
    { command: 'for f in supabase/migrations/*.sql; do cat "$f"; done' },
    'schema_rebuild_from_migration_chain',
  );
});

test('disabling row level security is not this gate', () => {
  allowed('Bash', { command: 'ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;' });
});

test('a uri stays allowed and raw image bytes in postgres are denied', () => {
  allowed('Bash', { command: "INSERT INTO photos (url) VALUES ('https://cdn.example/a.png');" });
  denied(
    { command: "INSERT INTO photos (blob) VALUES (decode('abcdefghijklmnopqrstuvwxyz0123456789ABCD==', 'base64'));" },
    'raw_binary_in_postgres',
  );
  denied(
    { contents: 'create table public.photos (avatar bytea);' },
    'raw_binary_in_postgres',
  );
  denied(
    { command: 'shove the png bytes into postgres' },
    'raw_binary_in_postgres',
  );
});

test('supabase start stays allowed and a docker-only local database is denied', () => {
  allowed('Bash', { command: 'supabase start' });
  allowed('Bash', { command: 'docker build -t thumbgate .' });
  denied(
    { command: 'the local database requires docker' },
    'local_database_requires_docker',
  );
  denied(
    { command: 'cannot start supabase without docker' },
    'local_database_requires_docker',
  );
});

test('an edge auth check stays allowed and chunking inside the edge function is denied', () => {
  allowed('Write', {
    file_path: 'supabase/functions/auth/index.ts',
    contents: 'export function handler() { return new Response("ok"); }',
  });
  denied(
    { command: 'generate embeddings inside the edge function' },
    'durable_work_inside_edge_function',
  );
  denied(
    {
      file_path: 'supabase/functions/embed/index.ts',
      contents: 'generate embeddings for each uploaded pdf',
    },
    'durable_work_inside_edge_function',
  );
  allowed('Bash', {
    command: 'move embedding generation out of the edge function onto colocated compute',
  });
});

test('a select stays allowed and one postgres as the warehouse is denied', () => {
  allowed('Bash', { command: 'select count(*) from public.events;' });
  denied(
    { command: 'use postgres as the analytics warehouse' },
    'postgres_used_as_analytics_warehouse',
  );
  denied(
    { command: 'run olap against the primary postgres' },
    'postgres_used_as_analytics_warehouse',
  );
  allowed('Bash', {
    command: 'do not use postgres as the analytics warehouse; route olap to duckdb',
  });
});

test('a token bill line stays allowed and a token-spend leaderboard as the roi metric is denied', () => {
  allowed('Bash', { command: 'record this month token spend in the finance note' });
  denied(
    { command: 'rank engineers by token spend' },
    'ai_roi_by_token_leaderboard',
  );
  denied(
    { command: 'the success metric is token spend' },
    'ai_roi_by_token_leaderboard',
  );
  allowed('Bash', {
    command: 'do not rank engineers by token spend; count end-to-end processes with no human in the loop',
  });
});

test('the gate file does not store the interview numbers or install a vendor cli', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'supabase-agent-native-gate.js'), 'utf8');
  assert.equal(/\b125%|\$300k|1\.5x|71\.4%/.test(source), false);
  assert.equal(/child_process|npx supabase|require\('pg-delta'\)/.test(source), false);
});

test('the pre-tool hook calls the gate', () => {
  const hook = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'hook-pre-tool-use.js'), 'utf8');
  assert.match(hook, /evaluateSupabaseAgentNativePretool/);
  assert.match(hook, /supabase-agent-native:/);
});
