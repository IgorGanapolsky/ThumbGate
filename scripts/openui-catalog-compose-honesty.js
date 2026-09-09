#!/usr/bin/env node
'use strict';

/**
 * OpenUI catalog-compose honesty doctor (FORMAT steal, not a product clone).
 *
 * Source: https://www.openui.com/
 *
 * Transfers (process only):
 *   1. Catalog-compose-only — model may compose from an allowlisted component
 *      catalog; never invent arbitrary components or run generated code.
 *   2. Root-first streaming — structure assigns `root` before children fill in.
 *   3. Repair-before-claim — validate line-by-line, drop/repair invalid lines,
 *      and refuse "UI ready / compose done" claims without a clean repair pass.
 *
 * Does NOT install @openuidev/cli, OpenUI Lang, Thesys Gateway, or Observability.
 * Does NOT ship a generative-UI SKU. ECI: no net-new agent-governance product.
 */

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_URL = 'https://www.openui.com/';

const ARBITRARY_CODE_RE =
  /\b(eval\s*\(|new\s+Function\s*\(|dangerouslySetInnerHTML|innerHTML\s*=|document\.write\s*\(|<script\b|Function\s*\(\s*['"`])/i;

const OPENUI_SKU_CLONE_RE =
  /@openuidev\/cli|openui\s+gateway|thesys\.dev|pnpx\s+@openuidev|clone\s+openui|install\s+openui\s+lang/i;

const COMPOSE_LINE_RE =
  /^\s*([A-Za-z_][\w.-]*)\s*=\s*([A-Za-z_][\w.-]*)\s*(?:\((.*)\))?\s*$/;

function normalizeBoolean(value) {
  if (value === true) return true;
  if (value === false || value === undefined || value === null) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function readText(filePath) {
  if (!filePath) return null;
  if (!fs.existsSync(filePath)) {
    const err = new Error(`file not found: ${filePath}`);
    err.code = 'ENOENT';
    throw err;
  }
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Accepts:
 *   { "components": ["Stack","Card"] }
 *   { "components": [{ "id": "Stack" }, { "id": "Card", "props": ["title"] }] }
 *   ["Stack","Card"]
 */
function parseCatalog(raw) {
  if (raw == null || raw === '') {
    return { ok: false, error: 'empty_catalog', ids: new Set(), entries: [] };
  }
  let data;
  try {
    data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return { ok: false, error: 'catalog_parse_error', ids: new Set(), entries: [] };
  }

  let list = [];
  if (Array.isArray(data)) list = data;
  else if (data && Array.isArray(data.components)) list = data.components;
  else {
    return { ok: false, error: 'catalog_shape_error', ids: new Set(), entries: [] };
  }

  const entries = [];
  const ids = new Set();
  for (const item of list) {
    if (typeof item === 'string' && item.trim()) {
      const id = item.trim();
      ids.add(id);
      entries.push({ id, props: null });
      continue;
    }
    if (item && typeof item === 'object' && item.id) {
      const id = String(item.id).trim();
      if (!id) continue;
      ids.add(id);
      entries.push({
        id,
        props: Array.isArray(item.props) ? item.props.map(String) : null,
      });
    }
  }
  if (ids.size === 0) {
    return { ok: false, error: 'empty_catalog_ids', ids, entries };
  }
  return { ok: true, error: null, ids, entries };
}

/**
 * Line-oriented compose stream inspired by OpenUI Lang's streaming shape,
 * not a clone of OpenUI Lang syntax. Form:
 *   root = Stack([header, body])
 *   header = Card()
 *   body = Table([row])
 */
function parseComposeStream(raw) {
  const text = String(raw == null ? '' : raw);
  const lines = text.split(/\r?\n/);
  const parsed = [];
  for (let i = 0; i < lines.length; i += 1) {
    const original = lines[i];
    const trimmed = original.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      parsed.push({
        line: i + 1,
        original,
        kind: 'skip',
        binding: null,
        component: null,
        refs: [],
        validSyntax: true,
      });
      continue;
    }
    if (ARBITRARY_CODE_RE.test(trimmed) || OPENUI_SKU_CLONE_RE.test(trimmed)) {
      parsed.push({
        line: i + 1,
        original,
        kind: 'dangerous',
        binding: null,
        component: null,
        refs: [],
        validSyntax: false,
        danger: ARBITRARY_CODE_RE.test(trimmed) ? 'arbitrary_code' : 'openui_sku_clone',
      });
      continue;
    }
    const m = COMPOSE_LINE_RE.exec(trimmed);
    if (!m) {
      parsed.push({
        line: i + 1,
        original,
        kind: 'invalid',
        binding: null,
        component: null,
        refs: [],
        validSyntax: false,
      });
      continue;
    }
    const binding = m[1];
    const component = m[2];
    const args = m[3] == null ? '' : m[3];
    const refs = [];
    const refRe = /\b([A-Za-z_][\w.-]*)\b/g;
    let rm;
    while ((rm = refRe.exec(args)) !== null) {
      const token = rm[1];
      // Skip obvious literals / keywords
      if (/^(true|false|null|undefined)$/i.test(token)) continue;
      if (/^\d/.test(token)) continue;
      refs.push(token);
    }
    parsed.push({
      line: i + 1,
      original,
      kind: binding === 'root' ? 'root' : 'node',
      binding,
      component,
      refs,
      validSyntax: true,
    });
  }
  return parsed;
}

function collectComponentRefs(parsedLines) {
  const refs = [];
  for (const row of parsedLines) {
    if (!row.validSyntax || !row.component) continue;
    refs.push({ line: row.line, binding: row.binding, component: row.component });
  }
  return refs;
}

function repairComposeStream(parsedLines, catalogIds) {
  const kept = [];
  const dropped = [];
  for (const row of parsedLines) {
    if (row.kind === 'skip') {
      kept.push(row);
      continue;
    }
    if (!row.validSyntax || row.kind === 'dangerous' || row.kind === 'invalid') {
      dropped.push({ line: row.line, reason: row.danger || row.kind, text: row.original });
      continue;
    }
    if (!catalogIds.has(row.component)) {
      dropped.push({
        line: row.line,
        reason: 'unknown_component',
        component: row.component,
        text: row.original,
      });
      continue;
    }
    kept.push(row);
  }
  const repairedText = kept
    .filter((r) => r.kind !== 'skip' || String(r.original).trim() === '')
    .map((r) => r.original)
    .join('\n')
    .replace(/\n+$/, '');
  const hasRoot = kept.some((r) => r.kind === 'root');
  return {
    kept,
    dropped,
    repairedText: repairedText.length ? `${repairedText}\n` : '',
    hasRoot,
    clean: dropped.length === 0 && hasRoot,
  };
}

function buildFindings({
  catalog,
  parsed,
  repair,
  claimReady,
  cloneSignal,
}) {
  const findings = [];

  if (!catalog.ok) {
    findings.push({
      id: catalog.error || 'missing_catalog',
      severity: 'fail',
      gateId: 'require-catalog-compose-only',
      message: 'Catalog missing or unparseable. Provide --catalog=path with a non-empty components list.',
    });
  } else if (catalog.ids.size === 0) {
    findings.push({
      id: 'empty_catalog_ids',
      severity: 'fail',
      gateId: 'require-catalog-compose-only',
      message: 'Catalog has zero component ids.',
    });
  }

  const structural = parsed.filter((p) => p.kind !== 'skip');
  if (structural.length === 0) {
    findings.push({
      id: 'empty_compose_stream',
      severity: 'fail',
      gateId: 'require-catalog-compose-only',
      message: 'Compose stream is empty. Provide --stream=path with root-first catalog lines.',
    });
  }

  for (const row of parsed) {
    if (row.kind === 'dangerous' && row.danger === 'arbitrary_code') {
      findings.push({
        id: 'arbitrary_code_in_compose',
        severity: 'fail',
        gateId: 'require-catalog-compose-only',
        line: row.line,
        message: `Line ${row.line}: arbitrary code marker — catalog compose must never eval/run generated code.`,
      });
    }
    if (row.kind === 'dangerous' && row.danger === 'openui_sku_clone') {
      findings.push({
        id: 'openui_sku_clone',
        severity: 'fail',
        gateId: 'require-catalog-compose-only',
        line: row.line,
        message: `Line ${row.line}: OpenUI/Thesys SKU clone signal — steal FORMAT only; do not install @openuidev or Gateway.`,
      });
    }
    if (row.kind === 'invalid') {
      findings.push({
        id: 'invalid_compose_syntax',
        severity: 'fail',
        gateId: 'require-repair-before-compose-claim',
        line: row.line,
        message: `Line ${row.line}: invalid compose syntax (expected binding = Component(...)).`,
      });
    }
  }

  if (catalog.ok) {
    for (const ref of collectComponentRefs(parsed)) {
      if (!catalog.ids.has(ref.component)) {
        findings.push({
          id: 'unknown_component',
          severity: 'fail',
          gateId: 'require-catalog-compose-only',
          line: ref.line,
          component: ref.component,
          message: `Line ${ref.line}: component "${ref.component}" is not in the allowlisted catalog.`,
        });
      }
    }
  }

  const rootLines = parsed.filter((p) => p.kind === 'root');
  if (structural.length > 0 && rootLines.length === 0) {
    findings.push({
      id: 'missing_root',
      severity: 'fail',
      gateId: 'require-catalog-compose-only',
      message: 'Compose stream has no root = ... assignment (root-first streaming honesty).',
    });
  }

  const firstStructural = structural[0];
  if (firstStructural && firstStructural.kind !== 'root' && rootLines.length > 0) {
    findings.push({
      id: 'root_not_first',
      severity: 'warn',
      gateId: 'require-catalog-compose-only',
      message: `Root appears after other nodes (first structural line ${firstStructural.line}). Prefer root-first streaming.`,
    });
  }

  if (cloneSignal) {
    findings.push({
      id: 'openui_sku_clone',
      severity: 'fail',
      gateId: 'require-catalog-compose-only',
      message: 'Input requests cloning OpenUI/Thesys product surface. Refuse SKU clone; keep FORMAT steal only.',
    });
  }

  if (claimReady) {
    if (!repair || !repair.clean) {
      findings.push({
        id: 'claim_without_repair',
        severity: 'fail',
        gateId: 'require-repair-before-compose-claim',
        message:
          'Claimed compose/UI ready without a clean validate+repair pass. Run with --repair and zero drops + root present before claiming.',
      });
    }
  }

  return findings;
}

function normalizeOptions(raw = {}) {
  const rootDir = path.resolve(
    String(raw.root || raw.rootDir || process.cwd())
  );
  const catalogPath = raw.catalog
    ? path.resolve(rootDir, String(raw.catalog))
    : raw.catalogPath
      ? path.resolve(rootDir, String(raw.catalogPath))
      : null;
  const streamPath = raw.stream || raw.compose
    ? path.resolve(rootDir, String(raw.stream || raw.compose))
    : raw.streamPath
      ? path.resolve(rootDir, String(raw.streamPath))
      : null;

  return {
    rootDir,
    catalogPath,
    streamPath,
    catalogText: raw.catalogText != null ? String(raw.catalogText) : null,
    streamText: raw.streamText != null ? String(raw.streamText) : null,
    repair: normalizeBoolean(raw.repair),
    claimReady: normalizeBoolean(raw['claim-ready'] || raw.claimReady),
    strict: normalizeBoolean(raw.strict),
    json: normalizeBoolean(raw.json),
  };
}

function buildOpenuiCatalogComposeHonestyReport(rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  let catalogRaw = options.catalogText;
  let streamRaw = options.streamText;
  const ioErrors = [];

  if (catalogRaw == null && options.catalogPath) {
    try {
      catalogRaw = readText(options.catalogPath);
    } catch (err) {
      ioErrors.push({ id: 'catalog_read_error', message: err.message });
      catalogRaw = '';
    }
  }
  if (streamRaw == null && options.streamPath) {
    try {
      streamRaw = readText(options.streamPath);
    } catch (err) {
      ioErrors.push({ id: 'stream_read_error', message: err.message });
      streamRaw = '';
    }
  }

  // Fixture mode when nothing provided: demonstrate fail-closed empty state.
  if (catalogRaw == null && streamRaw == null) {
    catalogRaw = '';
    streamRaw = '';
  }

  const catalog = parseCatalog(catalogRaw || '');
  const parsed = parseComposeStream(streamRaw || '');
  const cloneSignal = OPENUI_SKU_CLONE_RE.test(String(catalogRaw || ''))
    || OPENUI_SKU_CLONE_RE.test(String(streamRaw || ''));

  const repair = repairComposeStream(parsed, catalog.ids);
  const findings = [
    ...ioErrors.map((e) => ({
      id: e.id,
      severity: 'fail',
      gateId: 'require-catalog-compose-only',
      message: e.message,
    })),
    ...buildFindings({
      catalog,
      parsed,
      repair,
      claimReady: options.claimReady,
      cloneSignal,
    }),
  ];

  // Deduplicate finding ids+line
  const seen = new Set();
  const deduped = [];
  for (const f of findings) {
    const key = `${f.id}:${f.line || ''}:${f.component || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(f);
  }

  const failCount = deduped.filter((f) => f.severity === 'fail').length;
  const warnCount = deduped.filter((f) => f.severity === 'warn').length;
  let status = 'ready';
  if (failCount > 0) status = 'fail';
  else if (warnCount > 0) status = 'actionable';

  return {
    name: 'thumbgate-openui-catalog-compose-honesty',
    status,
    source: SOURCE_URL,
    disclaimer:
      'FORMAT steal from OpenUI (catalog-compose-only, root-first streaming, repair-before-claim). Not affiliated with OpenUI/Thesys. Does not install @openuidev or ship a generative-UI SKU.',
    rootDir: options.rootDir,
    metrics: {
      catalogPath: options.catalogPath,
      streamPath: options.streamPath,
      catalogOk: catalog.ok,
      catalogSize: catalog.ids.size,
      streamLines: parsed.length,
      structuralLines: parsed.filter((p) => p.kind !== 'skip').length,
      rootPresent: parsed.some((p) => p.kind === 'root'),
      repairRequested: options.repair,
      claimReady: options.claimReady,
      droppedLineCount: repair.dropped.length,
      keptLineCount: repair.kept.filter((k) => k.kind !== 'skip').length,
      repairClean: repair.clean,
    },
    repair: options.repair
      ? {
          clean: repair.clean,
          dropped: repair.dropped,
          repairedText: repair.repairedText,
        }
      : {
          clean: repair.clean,
          droppedCount: repair.dropped.length,
          note: 'Pass --repair to include dropped lines and repaired stream text.',
        },
    findings: deduped,
    summary: {
      failCount,
      warnCount,
      findingCount: deduped.length,
      recommendedGateCount: [...new Set(deduped.map((f) => f.gateId).filter(Boolean))].length,
    },
    recommendedGates: [...new Set(deduped.map((f) => f.gateId).filter(Boolean))],
    nextActions: [
      'Compose only from an allowlisted component catalog — never invent components or eval generated code.',
      'Emit root = ... first, then fill child bindings (root-first streaming).',
      'Validate + repair invalid lines before claiming UI/compose ready.',
      'Do not install @openuidev/cli, OpenUI Gateway, or Thesys Observability as a ThumbGate SKU.',
      'Pair with gates require-catalog-compose-only and require-repair-before-compose-claim.',
    ],
    exampleCommand:
      'npx thumbgate openui-catalog-compose-honesty --catalog=catalog.json --stream=compose.txt --repair --json',
  };
}

function formatOpenuiCatalogComposeHonestyReport(report) {
  const lines = [
    '',
    'ThumbGate OpenUI Catalog-Compose Honesty Doctor',
    '-'.repeat(48),
    `Status   : ${report.status}`,
    `Root     : ${report.rootDir}`,
    `Catalog  : ${report.metrics.catalogPath || '(inline/empty)'} (${report.metrics.catalogSize} ids, ok=${report.metrics.catalogOk})`,
    `Stream   : ${report.metrics.streamPath || '(inline/empty)'} (${report.metrics.structuralLines} structural)`,
    `Root line: ${report.metrics.rootPresent}`,
    `Repair   : clean=${report.metrics.repairClean} dropped=${report.metrics.droppedLineCount}`,
    `Findings : ${report.summary.findingCount} (fail=${report.summary.failCount}, warn=${report.summary.warnCount})`,
    `Source   : ${report.source}`,
  ];
  if (report.findings.length) {
    lines.push('', 'Findings:');
    for (const f of report.findings) {
      const gate = f.gateId ? ` [${f.gateId}]` : '';
      const loc = f.line ? ` L${f.line}` : '';
      lines.push(`  - [${f.severity}] ${f.id}${loc}${gate}`);
      lines.push(`    ${f.message}`);
    }
  }
  if (report.repair && report.repair.dropped && report.repair.dropped.length) {
    lines.push('', 'Repaired drops:');
    for (const d of report.repair.dropped) {
      lines.push(`  - L${d.line} ${d.reason}${d.component ? ` (${d.component})` : ''}`);
    }
  }
  lines.push('', 'Next actions:');
  for (const a of report.nextActions) lines.push(`  - ${a}`);
  lines.push('', `Example: ${report.exampleCommand}`);
  lines.push(`Note: ${report.disclaimer}`, '');
  return `${lines.join('\n')}\n`;
}

function parseCliArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (arg === '--json') { options.json = true; continue; }
    if (arg === '--strict') { options.strict = true; continue; }
    if (arg === '--repair') { options.repair = true; continue; }
    if (arg === '--claim-ready') { options['claim-ready'] = true; continue; }
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!m) continue;
    options[m[1]] = m[2] === undefined ? true : m[2];
  }
  return options;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/openui-catalog-compose-honesty.js [flags]

Flags:
  --catalog=PATH     JSON catalog ({"components":["Stack","Card"]})
  --stream=PATH      Line-oriented compose stream (root = Stack([...]))
  --compose=PATH     Alias for --stream
  --repair           Include dropped lines + repaired stream text
  --claim-ready      Fail unless repair is clean (root + zero drops)
  --root=DIR         Repo root for relative paths (default: cwd)
  --strict           Exit 1 on fail/actionable
  --json

Source: ${SOURCE_URL}
`);
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  const report = buildOpenuiCatalogComposeHonestyReport(args);
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatOpenuiCatalogComposeHonestyReport(report));
  if (args.strict && report.status !== 'ready') return 1;
  if (report.status === 'fail') return 1;
  return 0;
}

module.exports = {
  SOURCE_URL,
  ARBITRARY_CODE_RE,
  OPENUI_SKU_CLONE_RE,
  parseCatalog,
  parseComposeStream,
  repairComposeStream,
  collectComponentRefs,
  buildOpenuiCatalogComposeHonestyReport,
  formatOpenuiCatalogComposeHonestyReport,
  runCli,
};

if (require.main === module
  || (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename))) {
  process.exitCode = runCli(process.argv.slice(2));
}
