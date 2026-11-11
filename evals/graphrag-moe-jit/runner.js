'use strict';

/**
 * ReAct GraphRAG eval runner (MAC-20261111-04).
 *
 * Drives the existing pipelines in scripts/agentic-prompt-pipelines.js and puts
 * ThumbGate's stdio MCP `gate_check` in front of every graph query:
 *
 *   1. JIT compactor  -> trimContextJustInTime (deterministic pass, no model)
 *   2. Dual-stack MoE -> routeWorkload (Claude/Gemini rules, safe fallback, no model)
 *   3. ReAct GraphRAG -> runGraphRagTraversal (state machine: thought -> call ->
 *      observation, read-only Cypher guard, 3-failed-attempt halt)
 *
 * This file adds two things the pipeline does not do by itself:
 *   - a schema-first Cypher gate: every label and relationship type in a query
 *     must appear in the schema returned by get_graph_schema;
 *   - the gate_check call: only an "allow" verdict runs the query. warn, block
 *     and error throw, which the traversal records as a failed attempt.
 *
 * Model turns are scripted and the graph is an in-memory fixture, so a run is
 * deterministic and makes no network or LLM calls.
 */

const path = require('node:path');
const { spawn } = require('node:child_process');
const pipelines = require('../../scripts/agentic-prompt-pipelines');

const ROOT = path.resolve(__dirname, '..', '..');

/* ------------------------- schema-first Cypher gate ------------------------ */

function stripLiteralsAndComments(cypher) {
  return String(cypher || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

function extractPatternIdentifiers(cypher) {
  const text = stripLiteralsAndComments(cypher);
  const labels = new Set();
  const relationships = new Set();
  // Node patterns: (var:Label:Other {props})
  for (const m of text.matchAll(/\(\s*\w*\s*((?::\s*\w+\s*)+)/g)) {
    for (const l of m[1].split(':').map((s) => s.trim()).filter(Boolean)) labels.add(l);
  }
  // Label predicates after WHERE: n:Label (no space, so map entries like {id: x} do not match)
  const where = /\bWHERE\b([\s\S]*)$/i.exec(text);
  if (where) {
    for (const p of where[1].matchAll(/\b\w+:(\w+)\b/g)) labels.add(p[1]);
  }
  // Relationship patterns: [var:TYPE|OTHER*1..3]
  for (const m of text.matchAll(/\[\s*\w*\s*:\s*([\w|:\s]+)/g)) {
    for (const r of m[1].split(/[|:]/).map((s) => s.trim()).filter(Boolean)) relationships.add(r);
  }
  return { labels: [...labels], relationships: [...relationships], hasBackticks: text.includes('`') };
}

/** schema: the get_graph_schema shape, { labels: [], relationshipTypes: [] }. */
function checkSchemaFirstCypher(cypher, schema) {
  if (!schema || !Array.isArray(schema.labels) || !Array.isArray(schema.relationshipTypes)) {
    return { ok: false, reason: 'schema_first:no_schema' };
  }
  const ids = extractPatternIdentifiers(cypher);
  if (ids.hasBackticks) return { ok: false, reason: 'schema_first:backtick_identifier' };
  if (ids.labels.length === 0) return { ok: false, reason: 'schema_first:no_typed_node_pattern' };
  const unknownLabels = ids.labels.filter((l) => !schema.labels.includes(l));
  const unknownRels = ids.relationships.filter((r) => !schema.relationshipTypes.includes(r));
  if (unknownLabels.length) return { ok: false, reason: `schema_first:unknown_label:${unknownLabels.join(',')}` };
  if (unknownRels.length) return { ok: false, reason: `schema_first:unknown_relationship:${unknownRels.join(',')}` };
  return { ok: true, reason: null };
}

/* ------------------------------ gated graph tools -------------------------- */

/**
 * Wrap graph tools so each query passes the schema-first gate and gate_check.
 * The pipeline already runs checkReadOnlyCypher before executeCypher, so the
 * order per query is: read-only deny -> schema-first -> gate_check -> query.
 */
function createGatedGraphTools(tools, { gateCheck }) {
  if (typeof gateCheck !== 'function') throw new TypeError('gateCheck is required');
  const gateLog = [];
  let schema = null;

  async function gate(toolInput) {
    const verdict = (await gateCheck('graph_query', toolInput)) || { decision: 'error', reason: 'no verdict' };
    gateLog.push({ input: toolInput, decision: verdict.decision });
    if (verdict.decision !== 'allow') {
      throw new Error(`gate_check_${verdict.decision}: ${verdict.reason || 'no reason'}`);
    }
  }

  return {
    gateLog,
    async getGraphSchema() {
      schema = await tools.getGraphSchema();
      return schema;
    },
    async executeCypher(cypher) {
      const check = checkSchemaFirstCypher(cypher, schema);
      if (!check.ok) throw new Error(check.reason);
      await gate({ cypher });
      return tools.executeCypher(cypher);
    },
    async semanticSearch(term) {
      await gate({ semantic_search: term });
      return tools.semanticSearch(term);
    },
  };
}

/* --------------------------- stdio gate_check client ---------------------- */

/**
 * Spawn `thumbgate serve` once and call gate_check over JSON-RPC stdio.
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
  const send = (frame) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...frame })}\n`);
  const request = (method, params) => new Promise((resolve) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ error: { message: `timed out after ${timeoutMs}ms` } });
    }, timeoutMs);
    pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
    send({ id, method, params });
  });
  const ready = request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'graphrag-moe-jit-eval', version: '1' },
  }).then(() => send({ method: 'notifications/initialized' }));

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

/* ---------------------------------- eval ---------------------------------- */

function scriptedModel(turns) {
  const queue = [...turns];
  return async () => (queue.length ? queue.shift() : '<halt>script exhausted</halt>');
}

const noModel = async () => { throw new Error('model_disabled'); };

/**
 * Run one eval case: compact context, route, then traverse behind gate_check.
 * @param {object} c  { query, turns, rawContext?, tokenBudget?, graph }
 * @param {object} deps { gateCheck }
 */
async function runEvalCase(c, { gateCheck }) {
  const trim = await pipelines.trimContextJustInTime(c.rawContext || '', c.query, {
    callModel: noModel,
    tokenBudget: c.tokenBudget || 2000,
  });
  const route = await pipelines.routeWorkload(`${c.query}\n${trim.context}`, { callModel: noModel });
  const tools = createGatedGraphTools(c.graph, { gateCheck });
  const traversal = await pipelines.runGraphRagTraversal(c.query, {
    callModel: scriptedModel(c.turns),
    tools,
  });
  return { trim, route, traversal, gateLog: tools.gateLog };
}

module.exports = {
  extractPatternIdentifiers,
  checkSchemaFirstCypher,
  createGatedGraphTools,
  createStdioGateClient,
  scriptedModel,
  runEvalCase,
};
