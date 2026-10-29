'use strict';

// Latent Space interview with Supabase co-founders Paul Copplestone and Ant Wilson.
// https://www.youtube.com/watch?v=zHG6sAss_kE
// Format only. This module does not install pg-delta, the Supabase CLI, DuckDB,
// DuckLake, Turso, OrioleDB, Multigres, or Spark.
// Disabling row-level security is owned by the email-strategy gate.
// A real migration command, an application Docker build, and a commission
// sentence that is not the shortcut stay allowed.
// Interview growth, spend, and latency figures are not stored here.

const SOURCE = 'latent-space-supabase-2026-10-29';

const WRITE_TOOL_RE = /write|edit|bash|shell|exec|notebook|multiedit|apply_patch/i;

function isWriteTool(toolName) {
  return WRITE_TOOL_RE.test(String(toolName || ''));
}

function payloadText(toolInput) {
  if (typeof toolInput === 'string') return toolInput;
  if (!toolInput || typeof toolInput !== 'object') return '';
  const keys = ['command', 'cmd', 'path', 'file_path', 'target_file', 'contents', 'content', 'new_string', 'body'];
  return keys.map((key) => (toolInput[key] == null ? '' : String(toolInput[key]))).join('\n');
}

function walksMigrationChain(text) {
  const chain = /\b(?:reconstruct|rebuild|infer|figure out|parse|replay)\b[\s\S]{0,200}\b(?:all|every|hundreds of|sequential|historical)\b[\s\S]{0,80}\bmigrations?\b/i.test(text)
    || /\b(?:all|every|hundreds of|sequential|historical)\b[\s\S]{0,60}\bmigrations?\b[\s\S]{0,120}\b(?:schema|table shape|current tables)\b/i.test(text)
    || /\b(?:cat|find)\b[\s\S]{0,80}(?:supabase\/migrations|db\/migrate)[\s\S]{0,40}\*\.sql/i.test(text)
    || /\bfor\s+\w+\s+in\b[\s\S]{0,80}migrations\/\*\.sql/i.test(text);
  if (!chain) return false;
  const declarative = /\bschemas\/[\w./-]+\.sql\b/i.test(text) || /\bdeclarative schema\b/i.test(text);
  if (declarative && /\b(?:instead|single declarative|read schemas\/)/i.test(text)) return false;
  return true;
}

function rawBinaryInPostgres(text) {
  const sqlBytes = /\b(?:INSERT\s+INTO|UPDATE\s+[A-Za-z0-9_."]+)\b[\s\S]{0,800}(?:\bbytea\b|data:image\/(?:png|jpe?g|webp|gif)|\\x[0-9a-fA-F]{64,}|decode\s*\([\s\S]{0,120}?base64)/i.test(text);
  const column = /\b(?:image|photo|avatar|png|jpeg|blob)\s+bytea\b/i.test(text);
  const shove = /\b(?:store|insert|save|shove)\b[\s\S]{0,80}\b(?:raw )?(?:image|png|jpeg|binary) bytes\b[\s\S]{0,80}\b(?:postgres|postgresql|the table)\b/i.test(text);
  return sqlBytes || column || shove;
}

function requiresDockerForLocalDb(text) {
  return /\b(?:local (?:database|postgres|supabase)|supabase start)\b[\s\S]{0,200}\b(?:requires|must use|only (?:via|with|through)|needs)\b[\s\S]{0,40}\bdocker\b/i.test(text)
    || /\bdocker(?:\s+compose)?\s+(?:up|run)\b[\s\S]{0,120}\b(?:is the only way|only way)\b[\s\S]{0,80}\b(?:local (?:database|postgres)|supabase)\b/i.test(text)
    || /\b(?:cannot|can't|can not) start\b[\s\S]{0,60}\b(?:local (?:database|postgres|supabase)|supabase)\b[\s\S]{0,40}\bwithout docker\b/i.test(text);
}

function heavyWorkInEdge(text) {
  const edge = /\b(?:edge function|supabase\/functions\/)\b/i.test(text);
  const heavy = /\b(?:chunk(?:ing)?(?: the)? documents?|generate embeddings|embedding generation|durable agent(?:ic)? loop)\b/i.test(text);
  if (!edge || !heavy) return false;
  if (/\b(?:out of the edge|not inside (?:the |an )?edge|colocat\w*)\b/i.test(text)) return false;
  return true;
}

function postgresAsWarehouse(text) {
  const trap = /\bhtap\b/i.test(text)
    || /\bpostgres(?:ql)? as (?:the |our )?(?:analytics|analytical) warehouse\b/i.test(text)
    || /\bone postgres(?:ql)?\b[\s\S]{0,40}\b(?:oltp and olap|olap and oltp)\b/i.test(text)
    || /\bolap\b[\s\S]{0,40}\b(?:on|against) (?:the )?(?:primary|same) postgres\b/i.test(text);
  if (!trap) return false;
  if (/\b(?:duckdb|ducklake|columnar object storage|separate the olap)\b/i.test(text)) return false;
  return true;
}

function tokenLeaderboardRoi(text) {
  const board = /\btoken(?:-|\s)?spend leaderboard\b/i.test(text)
    || /\brank (?:engineers|teams|people) by token spend\b/i.test(text)
    || /\b(?:the )?success metric is token spend\b/i.test(text)
    || /\broi metric is (?:the )?token(?:-|\s)?spend\b/i.test(text);
  if (!board) return false;
  if (/\b(?:human-in-the-loop|no human in the loop|end-to-end processes?|zero human)\b/i.test(text)) return false;
  return true;
}

function evaluateSupabaseAgentNativePretool({ toolName, toolInput } = {}) {
  if (!isWriteTool(toolName)) {
    return { ok: true, blockers: [], source: SOURCE };
  }
  const text = payloadText(toolInput);
  const blockers = [];
  if (walksMigrationChain(text)) blockers.push('schema_rebuild_from_migration_chain');
  if (rawBinaryInPostgres(text)) blockers.push('raw_binary_in_postgres');
  if (requiresDockerForLocalDb(text)) blockers.push('local_database_requires_docker');
  if (heavyWorkInEdge(text)) blockers.push('durable_work_inside_edge_function');
  if (postgresAsWarehouse(text)) blockers.push('postgres_used_as_analytics_warehouse');
  if (tokenLeaderboardRoi(text)) blockers.push('ai_roi_by_token_leaderboard');
  return { ok: blockers.length === 0, blockers, source: SOURCE };
}

module.exports = {
  SOURCE,
  evaluateSupabaseAgentNativePretool,
};
