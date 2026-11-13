#!/usr/bin/env node
'use strict';

/**
 * Agent MCP config lint for database servers (read-only, local, static).
 *
 * Reads MCP config JSON files you pass in ("mcpServers", "servers" or
 * "mcp.servers" shapes only) and reports, per file:
 *   - database servers detected in the config
 *   - credential-looking values present in the config file
 *   - whether a read-only flag is present (not verified) or writes are enabled
 *
 * What it is not: it makes no connections, does not prove which databases an
 * agent can actually reach, does not check who can read the config file, and
 * does not assess env references (the server process or agent may still read
 * that env). A database role or gateway may enforce more or less than the
 * config shows. "None detected" is never a safety finding. Out of scope:
 * JSONC, TOML, Zed/Codex config shapes.
 */

const fs = require('node:fs');
const path = require('node:path');

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_LABEL = 60;

const DB_ENGINES = [
  ['postgres', /(^|[^a-z0-9])(postgres(ql)?|pg|supabase|neon)([^a-z0-9]|$)/i],
  ['mysql', /(^|[^a-z0-9])(mysql|mariadb)([^a-z0-9]|$)/i],
  ['sqlite', /(^|[^a-z0-9])sqlite3?([^a-z0-9]|$)/i],
  ['mongodb', /(^|[^a-z0-9])mongo(db)?([^a-z0-9]|$)/i],
  ['redis', /(^|[^a-z0-9])redis([^a-z0-9]|$)/i],
  ['mssql', /(^|[^a-z0-9])(mssql|sqlserver|sql-server)([^a-z0-9]|$)/i],
  ['snowflake', /(^|[^a-z0-9])snowflake([^a-z0-9]|$)/i],
  ['bigquery', /(^|[^a-z0-9])bigquery([^a-z0-9]|$)/i],
];
const DB_URL_SCHEME = /\b(postgres(ql)?|mysql|mariadb|mongodb(\+srv)?|redis|rediss|sqlserver|mssql):\/\//i;

const URL_USERPASS = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i;
const KV_SECRET = /(^|[?&;\s])(password|passwd|pwd|pass|token|apikey|api_key|secret|sslpassword)=[^&;\s]+/i;
const SECRET_KEY_NAME = /(PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|PRIVATE_KEY|AUTH|BEARER|DSN|CONNECTION_STRING|_URL$|_URI$|URL$|URI$)/i;
const ENV_REFERENCE = /^\$(\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)$/;
const SECRET_FLAG = /^--?(password|passwd|pwd|token|api-?key|secret)$/i;
const SECRET_FLAG_EQ = /^--?(password|passwd|pwd|token|api-?key|secret)=.+/i;

const READ_ONLY_FLAG = /^--?read-?only(=(.*))?$/i;
const WRITE_FLAG = /^--(allow-write|write|unrestricted|allow-ddl)(=(.*))?$/i;
const READ_ONLY_ENV_KEY = /^(READ_?ONLY|MCP_READ_?ONLY|.*_READ_?ONLY)$/i;
const WRITE_ENV_KEY = /^(ALLOW_WRITE|ALLOW_DDL|WRITE_ENABLED|.*_ALLOW_WRITE)$/i;

const FALSY = new Set(['false', '0', 'no', 'off']);
const TRUTHY = new Set(['true', '1', 'yes', 'on']);

/** Strip control characters, cap length. For anything printed from config. */
function safeLabel(value) {
  const s = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '?');
  return s.length > MAX_LABEL ? `${s.slice(0, MAX_LABEL)}...` : s;
}

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function collectServers(doc) {
  if (!isPlainObject(doc)) return [];
  const map = [doc.mcpServers, doc.servers, doc.mcp && doc.mcp.servers].find(isPlainObject);
  if (!map) return [];
  return Object.entries(map).filter(([, v]) => isPlainObject(v));
}

function credentialInString(s) {
  return URL_USERPASS.test(s) || KV_SECRET.test(s);
}

function inspectCredentials(server) {
  const args = Array.isArray(server.args) ? server.args.map(String) : [];
  const env = isPlainObject(server.env) ? server.env : {};
  const headers = isPlainObject(server.headers) ? server.headers : {};
  const where = [];
  args.forEach((a, i) => {
    if (credentialInString(a) || SECRET_FLAG_EQ.test(a) || (i > 0 && SECRET_FLAG.test(args[i - 1]))) where.push('args');
  });
  if (typeof server.url === 'string' && credentialInString(server.url)) where.push('url');
  const keys = [];
  for (const [k, v] of Object.entries(env)) {
    if (typeof v !== 'string' || !v || ENV_REFERENCE.test(v)) continue;
    if (credentialInString(v) || SECRET_KEY_NAME.test(k)) {
      if (SECRET_KEY_NAME.test(k) || credentialInString(v)) keys.push(safeLabel(k));
    }
  }
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v === 'string' && v && !ENV_REFERENCE.test(v) && /^(authorization|x-api-key|apikey|.*token.*)$/i.test(k)) keys.push(`header:${safeLabel(k)}`);
  }
  if (keys.length) where.push('env/headers');
  return { present: where.length > 0, where: [...new Set(where)], keyNames: [...new Set(keys)] };
}

function detectEngine(name, server) {
  const args = Array.isArray(server.args) ? server.args.map(String) : [];
  const env = isPlainObject(server.env) ? Object.values(server.env).filter((v) => typeof v === 'string') : [];
  const urls = [server.url].filter((v) => typeof v === 'string');
  for (const text of [...urls, ...env, ...args]) {
    const m = DB_URL_SCHEME.exec(text);
    if (m) {
      const s = m[1].toLowerCase();
      return s.startsWith('postgres') ? 'postgres' : s.startsWith('mongo') ? 'mongodb' : s.startsWith('redis') ? 'redis' : s === 'sqlserver' ? 'mssql' : s;
    }
  }
  const hay = [name, server.command, ...args, ...urls].filter(Boolean).join(' ');
  const hit = DB_ENGINES.find(([, re]) => re.test(hay));
  return hit ? hit[0] : null;
}

function flagState(args, env) {
  let readOnly = false;
  let write = false;
  for (const a of args) {
    const r = READ_ONLY_FLAG.exec(a);
    if (r) {
      const val = r[2] === undefined ? 'true' : r[2].toLowerCase();
      if (TRUTHY.has(val)) readOnly = true;
      if (FALSY.has(val)) write = true;
    }
    const w = WRITE_FLAG.exec(a);
    if (w) {
      const val = w[3] === undefined ? 'true' : w[3].toLowerCase();
      if (!FALSY.has(val)) write = true;
    }
  }
  for (const [k, v] of Object.entries(env)) {
    const val = String(v).toLowerCase();
    if (READ_ONLY_ENV_KEY.test(k)) {
      if (TRUTHY.has(val)) readOnly = true;
      if (FALSY.has(val)) write = true;
    }
    if (WRITE_ENV_KEY.test(k) && TRUTHY.has(val)) write = true;
  }
  return { readOnly, write };
}

function reviewServer(name, server) {
  const args = Array.isArray(server.args) ? server.args.map(String) : [];
  const env = isPlainObject(server.env) ? server.env : {};
  const engine = detectEngine(name, server);
  const flags = flagState(args, env);
  const creds = inspectCredentials(server);
  const findings = [];
  if (engine) {
    if (creds.present) {
      findings.push({ id: 'credential-in-config-file', severity: 'high', detail: `Credential-looking values are present in this config file (${creds.where.join(', ')}${creds.keyNames.length ? `; keys: ${creds.keyNames.join(', ')}` : ''}). Whether the agent can read them is not assessed.` });
    }
    if (flags.write) findings.push({ id: 'write-enabled-or-readonly-off', severity: 'high', detail: 'Config enables writes/DDL or turns read-only off (a read-only flag may conflict with it).' });
    else if (!flags.readOnly) findings.push({ id: 'read-only-flag-absent', severity: 'medium', detail: 'No read-only flag found in this config. The database role may still enforce it; not checked.' });
  }
  return {
    server: safeLabel(name),
    engine,
    databaseServerDetected: Boolean(engine),
    readOnlyFlagPresentNotVerified: Boolean(engine) && flags.readOnly && !flags.write,
    findings,
  };
}

function reviewConfigs(files) {
  const servers = [];
  const fileStatus = [];
  for (const file of files) {
    const label = safeLabel(path.basename(file));
    try {
      const st = fs.statSync(file);
      if (!st.isFile()) throw Object.assign(new Error('not a file'), { code: 'NOT_A_FILE' });
      if (st.size > MAX_FILE_BYTES) throw Object.assign(new Error('too large'), { code: 'TOO_LARGE' });
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      const entries = collectServers(doc);
      for (const [name, server] of entries) servers.push({ file: label, ...reviewServer(name, server) });
      fileStatus.push({ file: label, status: entries.length ? 'parsed' : 'no-recognised-servers', serversParsed: entries.length });
    } catch (err) {
      fileStatus.push({ file: label, status: 'unreadable', reason: safeLabel(err.code || 'invalid-json'), serversParsed: 0 });
    }
  }
  const dbs = servers.filter((s) => s.databaseServerDetected);
  return {
    schema: 'thumbgate.agent-mcp-db-lint/v1',
    scope: 'static lint of mcpServers/servers/mcp.servers JSON only; no connections; no secret values recorded; does not prove actual reach or enforcement; none detected is not a safety finding',
    files: fileStatus,
    questions: {
      databaseServersDetectedInConfig: dbs.map((s) => `${s.engine} via ${s.server} (${s.file})`),
      credentialLookingValuesInConfig: dbs.filter((s) => s.findings.some((f) => f.id === 'credential-in-config-file')).map((s) => s.server),
      readOnlyFlagNotPresent: dbs.filter((s) => !s.readOnlyFlagPresentNotVerified).map((s) => s.server),
      filesUnreadable: fileStatus.filter((f) => f.status === 'unreadable').length,
      filesWithNoRecognisedServers: fileStatus.filter((f) => f.status === 'no-recognised-servers').length,
    },
    servers,
  };
}

function formatText(report) {
  const q = report.questions;
  const lines = ['MCP config lint for database servers (static)'];
  for (const f of report.files) lines.push(`File ${f.file}: ${f.status}, ${f.serversParsed} servers parsed${f.reason ? ` (${f.reason})` : ''}`);
  lines.push(`Database servers detected in config: ${q.databaseServersDetectedInConfig.join('; ') || 'none detected'}`);
  lines.push(`Credential-looking values in config: ${q.credentialLookingValuesInConfig.join(', ') || 'none detected'}`);
  lines.push(`Read-only flag not present: ${q.readOnlyFlagNotPresent.join(', ') || 'none'}`);
  if (q.filesUnreadable) lines.push(`WARNING: ${q.filesUnreadable} file(s) unreadable; result is incomplete.`);
  if (q.filesWithNoRecognisedServers) lines.push(`WARNING: ${q.filesWithNoRecognisedServers} file(s) had no recognised servers (unsupported shape?); result is incomplete.`);
  for (const s of report.servers) for (const f of s.findings) lines.push(`- [${f.severity}] ${s.server}: ${f.id} - ${f.detail}`);
  lines.push(`Scope: ${report.scope}.`);
  return lines.join('\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const files = args.filter((a) => !a.startsWith('--'));
  if (!files.length) {
    process.stderr.write('usage: agent-data-reach-check.js [--json] <mcp-config.json>...\n');
    process.exit(2);
  }
  const report = reviewConfigs(files);
  process.stdout.write(`${json ? JSON.stringify(report, null, 2) : formatText(report)}\n`);
  if (report.questions.filesUnreadable) process.exitCode = 1;
}

module.exports = { reviewConfigs, reviewServer, formatText, safeLabel };
