'use strict';

/**
 * ReAct GraphRAG eval runner (MAC-20261111-04).
 *
 * A ReAct loop written as an explicit state machine. Every graph query passes,
 * in order: the read-only Cypher deny check, the schema-first Cypher gate, and
 * ThumbGate's stdio MCP `gate_check` tool. Only an "allow" from all three runs
 * the query; warn, block and error all fail closed.
 *
 * Steps run in topological order. Each step gets at most 3 attempts; the step's
 * planner may revise its query after a failed attempt. After the third failure
 * the step fails closed and every dependent step is skipped with that reason.
 *
 * Before each attempt the JIT compactor trims context to the step's token budget,
 * and the dual-stack router (built on scripts/model-tier-router.js classifyTask)
 * picks the local or frontier stack. No network or LLM calls: the graph store is
 * whatever `step.act` reads, which in the eval is an in-memory fixture.
 */

const path = require('node:path');
const { spawn } = require('node:child_process');
const { classifyTask } = require('../../scripts/model-tier-router');
const { estimateTokens } = require('../../scripts/context-footprint');

const MAX_ATTEMPTS = 3;
const ROOT = path.resolve(__dirname, '..', '..');

/* ------------------------------ Cypher checks ----------------------------- */

function stripLiteralsAndComments(cypher) {
  return String(cypher || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

const WRITE_CLAUSES = [
  [/\bCREATE\b/i, 'CREATE'],
  [/\bMERGE\b/i, 'MERGE'],
  [/\bDELETE\b/i, 'DELETE'],
  [/\bDETACH\b/i, 'DETACH'],
  [/\bSET\b/i, 'SET'],
  [/\bREMOVE\b/i, 'REMOVE'],
  [/\bDROP\b/i, 'DROP'],
  [/\bFOREACH\b/i, 'FOREACH'],
  [/\bLOAD\s+CSV\b/i, 'LOAD CSV'],
  [/\bIN\s+TRANSACTIONS\b/i, 'IN TRANSACTIONS'],
  [/\bapoc\./i, 'apoc procedure'],
  [/\bdbms\./i, 'dbms procedure'],
];

// Procedures a read-only agent may CALL. Everything else, including CALL { } subqueries, is denied.
const READ_ONLY_PROCEDURES = new Set(['db.labels', 'db.relationshiptypes', 'db.schema.visualization']);

function readOnlyCypherCheck(cypher) {
  const text = stripLiteralsAndComments(cypher);
  if (!text.trim()) return { allowed: false, reason: 'empty Cypher query' };
  for (const [pattern, name] of WRITE_CLAUSES) {
    if (pattern.test(text)) return { allowed: false, reason: `read-only deny: ${name} is not allowed` };
  }
  const calls = text.matchAll(/\bCALL\b\s*([\w.]+|\{)?/gi);
  for (const m of calls) {
    const proc = (m[1] || '').toLowerCase();
    if (!READ_ONLY_PROCEDURES.has(proc)) {
      return { allowed: false, reason: `read-only deny: CALL ${m[1] || ''} is not an allowed read procedure`.trim() };
    }
  }
  return { allowed: true, reason: 'read-only' };
}

function extractPatternIdentifiers(cypher) {
  const text = stripLiteralsAndComments(cypher);
  const labels = new Set();
  const relationships = new Set();
  // Node patterns: (var:Label:Other {props}) -- labels sit between "(" and "{" / ")".
  for (const m of text.matchAll(/\(\s*\w*\s*((?::\s*\w+\s*)+)/g)) {
    for (const l of m[1].split(':').map((s) => s.trim()).filter(Boolean)) labels.add(l);
  }
  // Label predicates in WHERE: n:Label (no whitespace, so map entries like {id: x} do not match).
  for (const m of text.matchAll(/\bWHERE\b[\s\S]*$/gi)) {
    for (const p of m[0].matchAll(/\b\w+:(\w+)\b/g)) labels.add(p[1]);
  }
  // Relationship patterns: [var:TYPE|OTHER*1..3].
  for (const m of text.matchAll(/\[\s*\w*\s*:\s*([\w|:\s]+)/g)) {
    for (const r of m[1].split(/[|:]/).map((s) => s.trim()).filter(Boolean)) relationships.add(r);
  }
  return { labels: [...labels], relationships: [...relationships], hasBackticks: text.includes('`') };
}

function schemaFirstCypherGate(cypher, schema) {
  if (!schema || !Array.isArray(schema.labels) || !Array.isArray(schema.relationships)) {
    return { allowed: false, reason: 'schema-first: no declared schema' };
  }
  const ids = extractPatternIdentifiers(cypher);
  if (ids.hasBackticks) return { allowed: false, reason: 'schema-first: backtick identifiers cannot be verified' };
  if (ids.labels.length === 0) return { allowed: false, reason: 'schema-first: query has no typed node pattern' };
  const unknownLabels = ids.labels.filter((l) => !schema.labels.includes(l));
  const unknownRels = ids.relationships.filter((r) => !schema.relationships.includes(r));
  if (unknownLabels.length || unknownRels.length) {
    const parts = [];
    if (unknownLabels.length) parts.push(`unknown labels ${unknownLabels.join(', ')}`);
    if (unknownRels.length) parts.push(`unknown relationships ${unknownRels.join(', ')}`);
    return { allowed: false, reason: `schema-first: ${parts.join('; ')}` };
  }
  return { allowed: true, reason: 'schema-first: all labels and relationships declared', ...ids };
}

/* ---------------------------- Topological order --------------------------- */

function topologicalOrder(steps) {
  const ids = steps.map((s) => s.id);
  const known = new Set(ids);
  if (known.size !== ids.length) return { ok: false, reason: 'duplicate step id' };
  for (const s of steps) {
    for (const d of s.dependsOn || []) {
      if (!known.has(d)) return { ok: false, reason: `step ${s.id} depends on unknown step ${d}` };
    }
  }
  const indegree = new Map(steps.map((s) => [s.id, (s.dependsOn || []).length]));
  const order = [];
  const ready = ids.filter((id) => indegree.get(id) === 0);
  while (ready.length) {
    const id = ready.shift();
    order.push(id);
    for (const s of steps) {
      if ((s.dependsOn || []).includes(id)) {
        indegree.set(s.id, indegree.get(s.id) - 1);
        if (indegree.get(s.id) === 0) ready.push(s.id);
      }
    }
  }
  if (order.length !== steps.length) return { ok: false, reason: 'dependency cycle detected' };
  return { ok: true, order };
}

/* ------------------------------- MoE router ------------------------------- */

const FRONTIER_TIERS = new Set(['frontier', 'bulkCloud']);

function routeStep(step, { contextTokens, attempt }) {
  const routed = classifyTask({
    type: step.taskType || 'extraction',
    contextTokens,
    riskLevel: step.riskLevel || 'low',
    retryCount: attempt - 1,
    tags: step.tags || [],
  });
  return { stack: FRONTIER_TIERS.has(routed.tier) ? 'frontier' : 'local', tier: routed.tier, reason: routed.reason };
}

/* ------------------------------ JIT compactor ----------------------------- */

function compactContext(items, budgetTokens) {
  const budget = Math.max(0, Number(budgetTokens) || 0);
  const indexed = (items || []).map((item, index) => ({ ...item, index, tokens: estimateTokens(item.text || '') }));
  const pinned = indexed.filter((i) => i.pinned);
  const optional = indexed.filter((i) => !i.pinned)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || b.index - a.index);
  const kept = [];
  let used = 0;
  for (const item of pinned) {
    if (used + item.tokens <= budget) {
      kept.push(item);
      used += item.tokens;
    } else {
      const room = Math.max(0, (budget - used) * 4 - 12);
      const text = `${String(item.text).slice(0, room)} [truncated]`;
      const tokens = estimateTokens(text);
      kept.push({ ...item, text, tokens, truncated: true });
      used += tokens;
    }
  }
  const dropped = [];
  for (const item of optional) {
    if (used + item.tokens <= budget) {
      kept.push(item);
      used += item.tokens;
    } else {
      dropped.push(item.id);
    }
  }
  kept.sort((a, b) => a.index - b.index);
  return {
    items: kept.map(({ index, tokens, ...rest }) => rest),
    usedTokens: used,
    budgetTokens: budget,
    dropped,
  };
}

/* --------------------------- stdio gate_check client ---------------------- */

/**
 * Spawn `thumbgate serve` once and send gate_check calls over JSON-RPC stdio.
 * Returns { gateCheck(toolName, toolInput) -> verdict, close() }.
 */
function createStdioGateClient({ env = {}, timeoutMs = 60000 } = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, 'bin', 'cli.js'), 'serve'], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let buffer = '';
  let nextId = 1;
  child.stderr.on('data', () => {});
  child.stdout.on('data', (chunk) => {
    const lines = (buffer + String(chunk)).split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim().startsWith('{')) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const waiter = pending.get(msg.id);
      if (waiter) {
        pending.delete(msg.id);
        waiter(msg);
      }
    }
  });
  const exited = new Promise((resolve) => child.on('close', resolve));
  child.on('close', () => {
    for (const waiter of pending.values()) waiter({ error: { message: 'gate server exited' } });
    pending.clear();
  });
  const request = (method, params) => new Promise((resolve) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ error: { message: `gate_check timed out after ${timeoutMs}ms` } });
    }, timeoutMs);
    pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const ready = request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'graphrag-moe-jit-eval', version: '1' },
  }).then(() => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`));

  async function gateCheck(toolName, toolInput) {
    await ready;
    const msg = await request('tools/call', { name: 'gate_check', arguments: { tool_name: toolName, tool_input: toolInput } });
    if (msg.error) return { decision: 'error', reason: msg.error.message || 'gate_check error' };
    try {
      return JSON.parse(msg.result.content[0].text);
    } catch {
      return { decision: 'error', reason: 'unparseable gate_check result' };
    }
  }

  async function close() {
    try { child.stdin.end(); } catch { /* already closed */ }
    const killer = setTimeout(() => child.kill(), 2000);
    await exited;
    clearTimeout(killer);
  }

  return { gateCheck, close };
}

/* ---------------------------- ReAct state machine -------------------------- */

const STATES = Object.freeze(['THOUGHT', 'COMPACT', 'ROUTE', 'GATE', 'ACT', 'OBSERVE', 'DONE', 'FAILED', 'SKIPPED']);

async function attemptStep(step, attempt, ctx) {
  const trace = [];
  const lastError = ctx.lastError;
  trace.push({ state: 'THOUGHT', attempt });
  const cypher = step.plan({ attempt, lastError, observations: ctx.observations });

  trace.push({ state: 'COMPACT' });
  const compacted = compactContext([
    { id: `${step.id}:goal`, text: step.goal || step.id, pinned: true },
    ...(step.dependsOn || []).map((d) => ({ id: `${d}:observation`, text: JSON.stringify(ctx.observations[d]), pinned: true })),
    ...(step.context || []),
  ], step.budgetTokens || 2000);

  trace.push({ state: 'ROUTE' });
  const route = routeStep(step, { contextTokens: compacted.usedTokens, attempt });

  trace.push({ state: 'GATE' });
  const readOnly = readOnlyCypherCheck(cypher);
  if (!readOnly.allowed) return { ok: false, error: readOnly.reason, trace, compacted, route, cypher };
  const schemaGate = schemaFirstCypherGate(cypher, ctx.schema);
  if (!schemaGate.allowed) return { ok: false, error: schemaGate.reason, trace, compacted, route, cypher };
  const verdict = await ctx.gateCheck('graph_query', { cypher, step: step.id, stack: route.stack });
  if (!verdict || verdict.decision !== 'allow') {
    const decision = verdict ? verdict.decision : 'error';
    return { ok: false, error: `gate_check ${decision}: ${(verdict && verdict.reason) || 'no reason'}`, trace, compacted, route, cypher, verdict };
  }

  trace.push({ state: 'ACT' });
  let observation;
  try {
    observation = await step.act({ cypher, context: compacted.items, route, observations: ctx.observations });
  } catch (err) {
    return { ok: false, error: `act failed: ${err.message}`, trace, compacted, route, cypher, verdict };
  }
  trace.push({ state: 'OBSERVE' });
  if (step.accept && !step.accept(observation)) {
    return { ok: false, error: 'observation rejected', trace, compacted, route, cypher, verdict };
  }
  return { ok: true, observation, trace, compacted, route, cypher, verdict };
}

async function runGraphRagEval({ steps, schema, gateCheck, maxAttempts = MAX_ATTEMPTS }) {
  if (typeof gateCheck !== 'function') throw new TypeError('gateCheck is required');
  const attemptsCap = Math.min(MAX_ATTEMPTS, Math.max(1, maxAttempts));
  const topo = topologicalOrder(steps);
  if (!topo.ok) return { status: 'failed', reason: `fail-closed before execution: ${topo.reason}`, order: [], results: {} };

  const byId = new Map(steps.map((s) => [s.id, s]));
  const observations = {};
  const results = {};
  let failed = false;
  for (const id of topo.order) {
    const step = byId.get(id);
    const blocker = (step.dependsOn || []).find((d) => results[d].state !== 'DONE');
    if (blocker) {
      results[id] = { state: 'SKIPPED', attempts: 0, reason: `fail-closed: upstream step ${blocker} did not complete` };
      continue;
    }
    const attempts = [];
    let lastError = null;
    let done = false;
    for (let attempt = 1; attempt <= attemptsCap; attempt++) {
      const outcome = await attemptStep(step, attempt, { schema, gateCheck, observations, lastError });
      attempts.push({ attempt, ok: outcome.ok, error: outcome.error || null, stack: outcome.route.stack, tier: outcome.route.tier, cypher: outcome.cypher, usedTokens: outcome.compacted.usedTokens, dropped: outcome.compacted.dropped, states: outcome.trace.map((t) => t.state) });
      if (outcome.ok) {
        observations[id] = outcome.observation;
        done = true;
        break;
      }
      lastError = outcome.error;
    }
    if (done) {
      results[id] = { state: 'DONE', attempts: attempts.length, history: attempts };
    } else {
      failed = true;
      results[id] = { state: 'FAILED', attempts: attempts.length, history: attempts, reason: `fail-closed after ${attempts.length} attempts: ${lastError}` };
    }
  }
  return { status: failed ? 'failed' : 'passed', order: topo.order, results, observations };
}

module.exports = {
  MAX_ATTEMPTS,
  STATES,
  readOnlyCypherCheck,
  schemaFirstCypherGate,
  extractPatternIdentifiers,
  topologicalOrder,
  routeStep,
  compactContext,
  createStdioGateClient,
  runGraphRagEval,
};
