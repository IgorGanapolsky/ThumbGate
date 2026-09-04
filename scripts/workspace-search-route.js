#!/usr/bin/env node
'use strict';

/**
 * Workspace search route doctor — zg (zvec-grep) FORMAT steal.
 *
 * Maps Qwen/zvec-ai's four local-first routes onto EXISTING ThumbGate rails:
 *   --rg      → ripgrep / Grep (exact / regex)
 *   --fts     → filesystem-search / BM25F lesson retrieval (lexical)
 *   --vector  → LanceDB / semantic lesson retrieval (optional dense)
 *   --hybrid  → pragmatic-hybrid-search RRF (default)
 *   --graph   → Graphify AST graph (architecture / causality)
 *
 * Does NOT install @zvec/zvec-grep, rebuild their index, or ship a new SKU.
 * Remote embeddings stay fail-closed unless THUMBGATE_ALLOW_REMOTE_EMBED=1.
 *
 * Source inspiration (not affiliated):
 *   https://github.com/zvec-ai/zvec-grep
 *   https://www.marktechpost.com/2026/09/02/qwen-developers-open-sources-zg-zvec-grep-a-local-first-search-layer-unifying-ripgrep-bm25-and-vector-search/
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SOURCE_URL = 'https://github.com/zvec-ai/zvec-grep';
const ROUTES = Object.freeze(['hybrid', 'fts', 'vector', 'rg', 'graph']);

const ROUTE_RAILS = Object.freeze({
  rg: {
    label: 'exact / regex',
    rails: ['rg', 'Grep/Glob'],
    when: 'Known symbol, path, error string, or regex.',
  },
  fts: {
    label: 'BM25 / lexical',
    rails: ['filesystem-search', 'lesson-retrieval BM25F', 'thumbgate search'],
    when: 'Known vocabulary; want ranked lexical hits without embeddings.',
  },
  vector: {
    label: 'semantic / dense',
    rails: ['LanceDB lesson vectors', 'lesson-semantic-retrieval'],
    when: 'Paraphrase / intent with little lexical overlap; local embedder available.',
  },
  hybrid: {
    label: 'RRF hybrid (default)',
    rails: ['pragmatic-hybrid-search', 'lesson-retrieval reciprocalRankFusion'],
    when: 'Default agent query: fuse lexical + optional dense with matchedBy provenance.',
  },
  graph: {
    label: 'AST / causality',
    rails: ['graphify query/path/explain'],
    when: 'Architecture / what-connects-X-to-Y; graphify-out/graph.json present.',
  },
});

function normalizeBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  const s = String(value).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function normalizeRoute(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim().toLowerCase().replace(/^--+/, '');
  if (s === 'bm25' || s === 'lexical') return 'fts';
  if (s === 'semantic' || s === 'dense' || s === 'embed') return 'vector';
  if (s === 'regex' || s === 'ripgrep' || s === 'grep') return 'rg';
  if (s === 'ast' || s === 'graphify') return 'graph';
  if (ROUTES.includes(s)) return s;
  return null;
}

function classifyQuery(queryText) {
  const q = String(queryText || '').trim();
  const reasons = [];
  if (!q) {
    return { route: 'hybrid', confidence: 0.4, reasons: ['empty query → hybrid default'] };
  }

  // Exact / regex signals
  if (/[.*+?^${}()|[\]\\]/.test(q) && /\b(rg|regex|grep)\b/i.test(q) === false) {
    // bare regex-ish tokens often mean exact
    if (/^[\w./:@-]+$/.test(q) === false && /[.()*?[\]|]/.test(q)) {
      reasons.push('regex metacharacters → prefer rg');
      return { route: 'rg', confidence: 0.85, reasons };
    }
  }
  if (
    /^(function|class|const|let|var|export|import)\s+\w+/i.test(q)
    || /^[A-Za-z_][\w.]*\(/i.test(q)
    || /\.[jt]sx?:?\d+/.test(q)
    || /^[\w-]+\.(js|ts|mjs|cjs|json|md|yml|yaml)$/i.test(q)
  ) {
    reasons.push('symbol/path shaped → rg');
    return { route: 'rg', confidence: 0.9, reasons };
  }
  if (/\b(how does|what connects|call graph|depends on|imports|architecture)\b/i.test(q)) {
    reasons.push('architecture / causality phrasing → graph');
    return { route: 'graph', confidence: 0.8, reasons };
  }
  if (/\b(similar to|conceptually|semantically|paraphrase|meaning of)\b/i.test(q)) {
    reasons.push('semantic phrasing → vector');
    return { route: 'vector', confidence: 0.75, reasons };
  }
  if (/\b(exact|literal|string|error message|stack trace)\b/i.test(q)) {
    reasons.push('exact-match cue → rg');
    return { route: 'rg', confidence: 0.8, reasons };
  }
  if (/\b(BM25|full[- ]?text|fts|keyword)\b/i.test(q)) {
    reasons.push('lexical cue → fts');
    return { route: 'fts', confidence: 0.8, reasons };
  }

  // Natural language without symbols → hybrid
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length >= 4) {
    reasons.push('multi-word natural language → hybrid RRF');
    return { route: 'hybrid', confidence: 0.7, reasons };
  }
  reasons.push('default → hybrid RRF');
  return { route: 'hybrid', confidence: 0.55, reasons };
}

function detectGraphify(rootDir) {
  const graph = path.join(rootDir, 'graphify-out', 'graph.json');
  const bin = path.join(rootDir, '.graphify-venv', 'bin', 'graphify');
  return {
    graphExists: fs.existsSync(graph),
    binExists: fs.existsSync(bin),
    graphPath: graph,
    binPath: bin,
  };
}

function detectRemoteEmbedGrant(env = process.env) {
  return normalizeBoolean(env.THUMBGATE_ALLOW_REMOTE_EMBED)
    || normalizeBoolean(env.THUMBGATE_ALLOW_REMOTE_EMBEDDING);
}

function buildFindings({ route, graphify, allowRemoteEmbed, forceRemote }) {
  const findings = [];
  if (route === 'graph' && !graphify.graphExists) {
    findings.push({
      id: 'graphify_graph_missing',
      severity: 'warn',
      message: 'graphify-out/graph.json missing. Run `npm run graphify:setup` before --graph, or fall back to hybrid.',
    });
  }
  if (route === 'vector' && forceRemote && !allowRemoteEmbed) {
    findings.push({
      id: 'remote_embed_ungranted',
      severity: 'fail',
      message: 'Remote embedding requested without grant. Set THUMBGATE_ALLOW_REMOTE_EMBED=1 (explicit) or use local LanceDB / hybrid without remote.',
    });
  }
  if (forceRemote && !allowRemoteEmbed) {
    findings.push({
      id: 'remote_embed_policy',
      severity: 'fail',
      message: 'zg-style local-first policy: remote embeddings require an explicit grant (THUMBGATE_ALLOW_REMOTE_EMBED=1).',
    });
  }
  return findings;
}

function runRipgrep(rootDir, query, limit) {
  const rg = spawnSync(
    'rg',
    ['-n', '--max-count', String(Math.max(1, limit)), '--', query, '.'],
    { cwd: rootDir, encoding: 'utf8', timeout: 15000 }
  );
  if (rg.error && rg.error.code === 'ENOENT') {
    return { ok: false, error: 'rg not found on PATH', hits: [] };
  }
  const lines = String(rg.stdout || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, limit)
    .map((line) => {
      const m = /^([^:]+):(\d+):(.*)$/.exec(line);
      if (!m) return { path: null, line: null, text: line, matchedBy: ['rg'] };
      return {
        path: m[1],
        line: Number(m[2]),
        text: m[3].slice(0, 240),
        matchedBy: ['rg'],
      };
    });
  return { ok: rg.status === 0 || rg.status === 1, hits: lines, exitCode: rg.status };
}

function runFilesystemFts(rootDir, query, limit) {
  try {
    const { searchFeedbackLog } = require('./filesystem-search');
    const rows = searchFeedbackLog(query, { limit, feedbackDir: path.join(rootDir, '.claude', 'memory', 'feedback') });
    return {
      ok: true,
      hits: (rows || []).slice(0, limit).map((r) => ({
        id: r.id || null,
        score: r._score || r.score || null,
        text: String(r.context || r.title || '').slice(0, 240),
        matchedBy: ['fts'],
        matchedTokens: r._matchedTokens || [],
      })),
    };
  } catch (err) {
    return { ok: false, error: err.message, hits: [] };
  }
}

function runHybrid(rootDir, query, limit) {
  try {
    const { pragmaticHybridSearch } = require('./pragmatic-hybrid-search');
    // Minimal empty corpus still exercises route wiring; callers pass lessons in production.
    const { results, meta } = pragmaticHybridSearch({
      query,
      lexical: [],
      dense: [],
      limit,
    });
    return {
      ok: true,
      hits: (results || []).slice(0, limit).map((r) => ({
        id: r.id || null,
        score: r.score || null,
        matchedBy: ['hybrid', ...(r.hybridFeatures ? Object.keys(r.hybridFeatures) : [])],
        text: String(r.title || r.context || '').slice(0, 240),
      })),
      meta: meta || null,
      note: 'Empty lexical/dense lists in doctor dry-run; production lesson-retrieval supplies ranked ids.',
    };
  } catch (err) {
    return { ok: false, error: err.message, hits: [] };
  }
}

function normalizeOptions(options = {}) {
  const rootDir = path.resolve(String(options.root || options.cwd || process.cwd()));
  const explicit = normalizeRoute(options.route || options.r || null)
    || (normalizeBoolean(options.rg) && 'rg')
    || (normalizeBoolean(options.fts) && 'fts')
    || (normalizeBoolean(options.vector) && 'vector')
    || (normalizeBoolean(options.hybrid) && 'hybrid')
    || (normalizeBoolean(options.graph) && 'graph')
    || null;
  return {
    rootDir,
    query: options.query || options.q || options._?.[0] || '',
    route: explicit,
    limit: Math.min(50, Math.max(1, Number(options.limit || 10) || 10)),
    execute: normalizeBoolean(options.execute) || normalizeBoolean(options.run),
    forceRemote: normalizeBoolean(options['force-remote']) || normalizeBoolean(options.remote),
    allowRemoteEmbed: detectRemoteEmbedGrant(options.env || process.env),
    json: normalizeBoolean(options.json),
    strict: normalizeBoolean(options.strict),
    mapOnly: normalizeBoolean(options.map) || normalizeBoolean(options['map-only']),
  };
}

function buildWorkspaceSearchRouteReport(rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  const classified = classifyQuery(options.query);
  const route = options.route || classified.route;
  const graphify = detectGraphify(options.rootDir);
  const findings = buildFindings({
    route,
    graphify,
    allowRemoteEmbed: options.allowRemoteEmbed,
    forceRemote: options.forceRemote,
  });

  const failCount = findings.filter((f) => f.severity === 'fail').length;
  const warnCount = findings.filter((f) => f.severity === 'warn').length;
  let status = 'ready';
  if (failCount > 0) status = 'fail';
  else if (warnCount > 0) status = 'actionable';

  const rail = ROUTE_RAILS[route] || ROUTE_RAILS.hybrid;
  const report = {
    name: 'thumbgate-workspace-search-route',
    status,
    source: SOURCE_URL,
    disclaimer:
      'FORMAT steal from Qwen/zvec-ai zg (zvec-grep): one interface for rg + BM25 + vector (+ graph). Not affiliated; does not install @zvec/zvec-grep or rebuild their index.',
    rootDir: options.rootDir,
    query: options.query,
    route,
    routeLabel: rail.label,
    confidence: options.route ? 1 : classified.confidence,
    reasons: options.route
      ? [`explicit --${route}`]
      : classified.reasons,
    rails: rail.rails,
    when: rail.when,
    routes: ROUTES.map((id) => ({ id, ...ROUTE_RAILS[id] })),
    graphify,
    remoteEmbedGranted: options.allowRemoteEmbed,
    findings,
    metrics: {
      routeCount: ROUTES.length,
      classifiedRoute: classified.route,
      explicitRoute: Boolean(options.route),
    },
    nextCommands: [
      route === 'rg' ? `rg -n -- '${options.query || '<pattern>'}' .` : null,
      route === 'fts' ? 'npx thumbgate search --source=all --json "<query>"' : null,
      route === 'hybrid' ? 'node -e "require(\'./scripts/pragmatic-hybrid-search\')"  # via lesson-retrieval' : null,
      route === 'graph' ? '.graphify-venv/bin/graphify query "<architecture question>"' : null,
      route === 'vector' ? 'npx thumbgate lessons --local --json  # semantic path when LanceDB present' : null,
      'npx thumbgate workspace-search-route --query="..." --json',
    ].filter(Boolean),
  };

  if (options.mapOnly || !options.execute) {
    return report;
  }

  // Execute against local rails (best-effort; never calls remote embed without grant).
  let execution = { route, ok: false };
  if (route === 'rg') {
    execution = { route, ...runRipgrep(options.rootDir, options.query, options.limit) };
  } else if (route === 'fts') {
    execution = { route, ...runFilesystemFts(options.rootDir, options.query, options.limit) };
  } else if (route === 'hybrid') {
    execution = { route, ...runHybrid(options.rootDir, options.query, options.limit) };
  } else if (route === 'vector') {
    if (options.forceRemote && !options.allowRemoteEmbed) {
      execution = { route, ok: false, error: 'remote embed refused (no grant)', hits: [] };
    } else {
      execution = {
        route,
        ok: true,
        hits: [],
        note: 'Vector execute stays advisory in doctor; use lesson-semantic-retrieval / LanceDB in-session.',
      };
    }
  } else if (route === 'graph') {
    if (!graphify.binExists || !graphify.graphExists) {
      execution = { route, ok: false, error: 'graphify not ready', hits: [] };
    } else {
      const out = spawnSync(graphify.binPath, ['query', options.query || 'ThumbGate gates'], {
        cwd: options.rootDir,
        encoding: 'utf8',
        timeout: 20000,
      });
      execution = {
        route,
        ok: out.status === 0,
        hits: String(out.stdout || '')
          .split(/\r?\n/)
          .filter(Boolean)
          .slice(0, options.limit)
          .map((text) => ({ text: text.slice(0, 240), matchedBy: ['graph'] })),
        stderr: out.stderr ? String(out.stderr).slice(0, 400) : null,
      };
    }
  }
  report.execution = execution;
  return report;
}

function formatWorkspaceSearchRouteReport(report) {
  const lines = [
    'ThumbGate Workspace Search Route (zg FORMAT steal)',
    `Status   : ${report.status}`,
    `Query    : ${report.query || '(none)'}`,
    `Route    : ${report.route} (${report.routeLabel}) confidence=${report.confidence}`,
    `Rails    : ${(report.rails || []).join(' · ')}`,
    `Reasons  : ${(report.reasons || []).join('; ')}`,
    `Remote embed grant: ${report.remoteEmbedGranted ? 'yes' : 'no'}`,
    `Graphify : graph=${report.graphify?.graphExists ? 'yes' : 'no'} bin=${report.graphify?.binExists ? 'yes' : 'no'}`,
  ];
  if (report.findings?.length) {
    lines.push('Findings:');
    for (const f of report.findings) {
      lines.push(`  [${f.severity}] ${f.id}: ${f.message}`);
    }
  }
  if (report.execution) {
    lines.push(`Execution: ok=${report.execution.ok} hits=${(report.execution.hits || []).length}`);
  }
  lines.push(`Source   : ${report.source}`);
  lines.push(report.disclaimer);
  return `${lines.join('\n')}\n`;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/workspace-search-route.js [options]

zg (zvec-grep) FORMAT steal — route a query to existing ThumbGate rails.
Does not install @zvec/zvec-grep.

Options:
  --query=<text>       Query to classify / optionally execute
  --route=hybrid|fts|vector|rg|graph
  --rg | --fts | --vector | --hybrid | --graph
  --execute            Run the chosen local rail (best-effort)
  --limit=<n>          Max hits when executing (default 10)
  --force-remote       Request remote embeddings (requires THUMBGATE_ALLOW_REMOTE_EMBED=1)
  --map-only           Print route map only
  --json
  --strict             Exit 1 unless status=ready
  --root=<dir>
`);
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return 0;
  }
  const options = {};
  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--execute' || arg === '--run') options.execute = true;
    else if (arg === '--map' || arg === '--map-only') options.map = true;
    else if (arg === '--force-remote' || arg === '--remote') options['force-remote'] = true;
    else if (arg === '--rg') options.rg = true;
    else if (arg === '--fts') options.fts = true;
    else if (arg === '--vector') options.vector = true;
    else if (arg === '--hybrid') options.hybrid = true;
    else if (arg === '--graph') options.graph = true;
    else if (arg.startsWith('--query=')) options.query = arg.slice('--query='.length);
    else if (arg.startsWith('--route=')) options.route = arg.slice('--route='.length);
    else if (arg.startsWith('--limit=')) options.limit = arg.slice('--limit='.length);
    else if (arg.startsWith('--root=')) options.root = arg.slice('--root='.length);
    else if (!arg.startsWith('-') && !options.query) options.query = arg;
  }

  const report = buildWorkspaceSearchRouteReport(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatWorkspaceSearchRouteReport(report));
  }
  if (options.strict && report.status !== 'ready') return 1;
  if (report.status === 'fail') return 1;
  return 0;
}

if (require.main === module || (
  process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(__filename)
)) {
  process.exitCode = main();
}

module.exports = {
  ROUTES,
  ROUTE_RAILS,
  classifyQuery,
  normalizeRoute,
  detectGraphify,
  detectRemoteEmbedGrant,
  buildWorkspaceSearchRouteReport,
  formatWorkspaceSearchRouteReport,
  main,
  SOURCE_URL,
};
