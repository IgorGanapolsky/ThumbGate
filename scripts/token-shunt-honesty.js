#!/usr/bin/env node
'use strict';

/**
 * Spotify Portal / shunt FORMAT steal — not a product clone.
 *
 * Sources:
 *   https://github.com/spotify/portal-ai-plugins
 *   GitHub App install 162279530 (Igor Spotify Portal) — catalog connector, not cash
 *
 * Transfers:
 *   1. Untargeted Read above 350 lines is blocked (SHUNT_MIN_LINES)
 *   2. Bare cat/head/tail/less/more of a large file is blocked; pipes to grep/rg pass
 *   3. Return a slice to the frontier model; do not dump the whole file back
 *   4. Do not delegate architecture/debug to Portal/AiKA/Gemini Flash
 *
 * Does NOT install shunt@portal, buy Spotify Portal, or sell ThumbGate through it.
 */

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_URLS = Object.freeze([
  'https://github.com/spotify/portal-ai-plugins',
  'https://github.com/settings/installations/162279530',
]);

const DEFAULT_MIN_LINES = 350;
const DEFAULT_SLICE_LINES = 80;
const REASONING_KINDS = Object.freeze(['reasoning', 'debug', 'architecture', 'safety']);
const DELEGABLE_KINDS = Object.freeze(['boilerplate', 'config', 'test_scaffold', 'large_read']);
const METERED_WORKERS = Object.freeze([
  'gemini-2.5-flash', 'gemini_2_5_flash', 'gemini_flash', 'portal', 'aika',
]);
const FRONTIER_WORKERS = Object.freeze([
  'hermes_main', 'hermes-main', 'grok', 'grok_4', 'grok_4_6', 'frontier',
]);

const CLONE_PATTERNS = Object.freeze([
  { id: 'portal_plugin', re: /\b(install|vendor|clone)\b.{0,40}\b(shunt@portal|@spotify\/portal-cli|portal-ai-plugins)\b/i },
  { id: 'portal_sku', re: /\b(buy|subscribe|checkout)\b.{0,40}\bspotify portal\b/i },
]);

const PIPE_TARGET_RE = /\|\s*(grep|rg|awk|sed)\b/i;
const HEAD_LIMIT_RE = /\b(?:head|tail)\b.*(?:-n|--lines)\b/i;
const BARE_READER_RE = /^(?:cat|head|tail|less|more)\b/i;

function normalizeBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function norm(value) {
  return String(value || '').trim().toLowerCase().replace(/[.-]/g, '_');
}

function detectCloneAttempt(text) {
  return CLONE_PATTERNS.filter((p) => p.re.test(String(text || ''))).map((p) => p.id);
}

function evaluateReadIntercept({ lineCount, targeted, threshold = DEFAULT_MIN_LINES } = {}) {
  const lines = Number(lineCount) || 0;
  const limit = Number(threshold) || DEFAULT_MIN_LINES;
  if (lines > limit && !targeted) {
    return {
      action: 'block_full_read',
      ok: false,
      id: 'untargeted_bulk_read',
      reason: `Untargeted read of ${lines} lines > ${limit}. Slice with offset/limit (default ${DEFAULT_SLICE_LINES}) instead of dumping the file into the frontier model.`,
    };
  }
  return {
    action: 'allow_read',
    ok: true,
    id: 'allow_read',
    reason: 'Small file or targeted offset/limit.',
  };
}

function countFileLines(filePath) {
  if (!filePath) return null;
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    if (!text) return 0;
    return text.split(/\r?\n/).length;
  } catch {
    return null;
  }
}

function stripWrappers(command) {
  let cmd = String(command || '').trim();
  cmd = cmd.replace(/^(?:env\s+)+/i, '');
  cmd = cmd.replace(/^(?:\/(?:usr\/)?bin\/)/, '');
  return cmd.trim();
}

function splitCompound(command) {
  return String(command).split(/\s*(?:\|\||&&|;)\s*/).map((s) => s.trim()).filter(Boolean);
}

function parseHeadTailLimit(stage) {
  const m = String(stage).match(/\b(?:head|tail)\b(?:\s+-n\s*|\s+--lines(?:=|\s+))(\d+)/i);
  return m ? Number(m[1]) : null;
}

function extractReaderPath(stage) {
  const tokens = String(stage).trim().split(/\s+/).filter((t) => !t.startsWith('-'));
  if (tokens.length < 2) return null;
  return tokens[tokens.length - 1];
}

function evaluateBashRead({ command, lineCount, cwd = process.cwd(), threshold = DEFAULT_MIN_LINES } = {}) {
  const raw = String(command || '').trim();
  const limit = Number(threshold) || DEFAULT_MIN_LINES;
  if (!raw) {
    return { action: 'skip_bash', ok: true, id: 'skip_bash', reason: 'No bash command.' };
  }
  const compounds = splitCompound(raw);
  for (const part of compounds) {
    const stages = part.split('|').map((s) => stripWrappers(s)).filter(Boolean);
    const last = stages[stages.length - 1] || '';
    const first = stages[0] || '';
    const headCount = parseHeadTailLimit(first) ?? parseHeadTailLimit(last);
    if (headCount != null) {
      if (headCount > limit) {
        return {
          action: 'block_bare_reader',
          ok: false,
          id: 'bare_bulk_cat',
          reason: `head/tail -n ${headCount} exceeds ${limit}-line slice. Cap --lines at the threshold.`,
        };
      }
      continue;
    }
    const lastIsBoundedFilter = /^(?:grep|rg)\b/i.test(last) && stages.length > 1;
    if (lastIsBoundedFilter) continue;
    const reader = first.match(/^(?:cat|head|tail|less|more)\b/i);
    if (reader) {
      let lines = Number.isFinite(Number(lineCount)) ? Number(lineCount) : null;
      if (lines == null) {
        const fileArg = extractReaderPath(first);
        lines = countFileLines(fileArg ? path.resolve(cwd, fileArg) : null);
      }
      if (lines == null) {
        return {
          action: 'warn_unknown_size',
          ok: false,
          id: 'unknown_size',
          reason: 'Bare reader without --lines and without a readable file. Do not invent a size; pass --lines or a path.',
        };
      }
      if (lines > limit) {
        return {
          action: 'block_bare_reader',
          ok: false,
          id: 'bare_bulk_cat',
          reason: `Bare ${reader[0]} of ${lines} lines bypasses Read intercept. Pipe to grep/rg or use head -n <= ${limit}.`,
        };
      }
    }
  }
  return { action: 'allow_bash', ok: true, id: 'allow_bash', reason: 'Not a bulk file dump.' };
}

function evaluateTaskRoute({ taskKind, model } = {}) {
  const kind = norm(taskKind);
  const worker = norm(model);
  if (!kind && !worker) {
    return { action: 'skip_route', ok: true, id: 'skip_route', reason: 'No task route to audit.' };
  }
  const metered = METERED_WORKERS.includes(worker) || worker.includes('flash');
  if (REASONING_KINDS.includes(kind)) {
    if (metered || worker.includes('local_slice') || worker.startsWith('portal') || worker.startsWith('aika')) {
      return {
        action: 'block_delegate_reason',
        ok: false,
        id: 'cheap_worker_reasoning',
        reason: 'Do not delegate debug/architecture to Portal, AiKA, or Gemini Flash.',
      };
    }
    if (!FRONTIER_WORKERS.includes(worker)) {
      return {
        action: 'block_metered',
        ok: false,
        id: 'unknown_route',
        reason: 'Reasoning needs an explicit frontier worker (hermes-main/grok). Missing or unrecognized models are denied.',
      };
    }
    return {
      action: 'allow_frontier',
      ok: true,
      id: 'allow_frontier',
      reason: 'Reasoning stays on the capable route.',
    };
  }
  if (DELEGABLE_KINDS.includes(kind)) {
    if (metered) {
      return {
        action: 'block_metered',
        ok: false,
        id: 'metered_worker',
        reason: 'Portal and Gemini Flash are outside the monthly cap. Use local_slice.',
      };
    }
    if (worker === 'local_slice') {
      return {
        action: 'allow_delegate',
        ok: true,
        id: 'allow_delegate',
        reason: 'Boilerplate and large reads use a local slice, not a frontier dump.',
      };
    }
  }
  if (kind || worker) {
    return {
      action: 'block_metered',
      ok: false,
      id: 'unknown_route',
      reason: 'Unknown task/worker is denied. Name boilerplate|config|test_scaffold|large_read + local_slice, or keep reasoning on frontier.',
    };
  }
  return { action: 'skip_route', ok: true, id: 'skip_route', reason: 'No task route to audit.' };
}

function evaluateContextReturn({ sourceLines, returnedLines, threshold = DEFAULT_MIN_LINES } = {}) {
  const source = Number(sourceLines) || 0;
  const returned = Number(returnedLines) || 0;
  const limit = Number(threshold) || DEFAULT_MIN_LINES;
  if (!source && !returned) {
    return { action: 'skip_return', ok: true, id: 'skip_return', reason: 'No return sizes.' };
  }
  if (source > limit && returned >= source) {
    return {
      action: 'block_full_dump',
      ok: false,
      id: 'full_file_dump',
      reason: 'Return only the relevant slice to the frontier model.',
    };
  }
  return {
    action: 'allow_slice',
    ok: true,
    id: 'allow_slice',
    reason: 'Frontier context is a slice, not the whole file.',
  };
}

function isTargetedRead(toolInput = {}) {
  const offset = Number(toolInput.offset);
  const limit = Number(toolInput.limit);
  return Number.isFinite(offset) || (Number.isFinite(limit) && limit > 0);
}

function evaluatePreToolUse({
  toolName,
  toolInput = {},
  cwd = process.cwd(),
  threshold = DEFAULT_MIN_LINES,
} = {}) {
  const name = String(toolName || '');
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  if (/^read$/i.test(name) || name === 'read_file') {
    const rel = input.file_path || input.path || input.target_file;
    const abs = rel ? path.resolve(cwd, String(rel)) : null;
    const lines = countFileLines(abs);
    if (lines == null) {
      return {
        action: 'warn_unknown_size',
        ok: true,
        id: 'unknown_size',
        reason: 'Read path missing or unreadable; not inventing a line count.',
      };
    }
    return evaluateReadIntercept({
      lineCount: lines,
      targeted: isTargetedRead(input),
      threshold,
    });
  }
  if (/^bash$/i.test(name) || name === 'Shell') {
    return evaluateBashRead({
      command: input.command || input.cmd,
      cwd,
      threshold,
    });
  }
  return {
    action: 'skip_tool',
    ok: true,
    id: 'skip_tool',
    reason: 'Not a Read/Bash dump surface.',
  };
}

function collectHaystack(options = {}) {
  const parts = [
    options.task,
    options.query,
    options['clone-portal'] ? 'install shunt@portal vendor @spotify/portal-cli buy Spotify Portal' : '',
  ];
  if (Array.isArray(options.argv)) parts.push(...options.argv);
  return parts.filter(Boolean).join(' ');
}

function buildTokenShuntHonestyReport(options = {}) {
  const findings = [];
  const cloneHits = [...new Set(detectCloneAttempt(collectHaystack(options)))];
  if (cloneHits.length) {
    findings.push({
      severity: 'fail',
      id: 'portal_clone_refused',
      message: `Refusing Portal / shunt@portal clones (${cloneHits.join(', ')}). Lint local Read/bash intercepts; do not buy Spotify Portal.`,
    });
  }

  const threshold = Number(options.threshold || options['min-lines']) || DEFAULT_MIN_LINES;
  const lineCount = options.lines != null ? Number(options.lines) : null;
  const targeted = normalizeBoolean(options.targeted);
  const hasRead = lineCount != null && !Number.isNaN(lineCount);
  const hasBash = Boolean(options.bash || options.command);
  const hasRoute = Boolean(options['task-kind'] || options.model);
  const hasReturn = options['source-lines'] != null || options['returned-lines'] != null;

  if (hasRead) {
    const d = evaluateReadIntercept({ lineCount, targeted, threshold });
    findings.push({
      severity: d.ok ? 'info' : 'fail',
      id: d.id,
      message: d.reason,
      action: d.action,
    });
  }
  if (hasBash) {
    const d = evaluateBashRead({
      command: options.bash || options.command,
      lineCount,
      cwd: options.cwd,
      threshold,
    });
    findings.push({
      severity: d.ok ? 'info' : 'fail',
      id: d.id,
      message: d.reason,
      action: d.action,
    });
  }
  if (hasRoute) {
    const d = evaluateTaskRoute({
      taskKind: options['task-kind'] || options.kind,
      model: options.model,
    });
    findings.push({
      severity: d.ok ? 'info' : 'fail',
      id: d.id,
      message: d.reason,
      action: d.action,
    });
  }
  if (hasReturn) {
    const d = evaluateContextReturn({
      sourceLines: options['source-lines'],
      returnedLines: options['returned-lines'],
      threshold,
    });
    findings.push({
      severity: d.ok ? 'info' : 'fail',
      id: d.id,
      message: d.reason,
      action: d.action,
    });
  }

  if (!cloneHits.length && !hasRead && !hasBash && !hasRoute && !hasReturn) {
    findings.push({
      severity: 'warn',
      id: 'no_trace',
      message: 'No --lines/--bash/--task-kind/--source-lines. Pass a Read/bash/return trace to lint. Complements PreToolUse; does not install Portal.',
    });
  }

  if (normalizeBoolean(options['all-repos-write'])) {
    findings.push({
      severity: 'warn',
      id: 'github_app_all_repos',
      message: 'GitHub App All-repositories write is a Portal catalog connector, not a cash rail and not a license to spam buy links on every repo.',
    });
  }

  let status = 'ready';
  if (findings.some((f) => f.severity === 'fail')) status = 'fail';
  else if (findings.some((f) => f.severity === 'warn')) status = 'ready_with_warnings';

  return {
    name: 'thumbgate-token-shunt-honesty',
    status,
    ok: status !== 'fail',
    minLines: threshold,
    sliceLines: DEFAULT_SLICE_LINES,
    compareNotClone: true,
    never: [
      'install shunt@portal or @spotify/portal-cli',
      'buy Spotify Portal / click Contact Sales as the cash path',
      'claim 90% token savings from installing the GitHub App',
      'delegate architecture/debug to Flash/Portal/AiKA',
      'dump a whole file back into the frontier context',
      'sell ThumbGate through Portal (ECI pause on paid outreach)',
    ],
    source: SOURCE_URLS,
    disclaimer: 'FORMAT steal only. Not affiliated with Spotify. Local Read/bash intercepts; no Portal SKU. GitHub App 162279530 is not revenue.',
    findings,
  };
}

function formatTokenShuntHonestyReport(report) {
  const lines = [
    'ThumbGate token-shunt honesty (Spotify Portal FORMAT steal)',
    `Status   : ${report.status}`,
    `ok       : ${report.ok}`,
    `MinLines : ${report.minLines} (untargeted Read above this is blocked)`,
  ];
  if (report.findings?.length) {
    lines.push('Findings:');
    for (const f of report.findings) lines.push(`  [${f.severity}] ${f.id}: ${f.message}`);
  }
  lines.push(`Never    : ${(report.never || []).join('; ')}`);
  lines.push(report.disclaimer);
  return `${lines.join('\n')}\n`;
}

function parseArgv(argv) {
  const options = { argv };
  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--targeted') options.targeted = true;
    else if (arg === '--clone-portal') options['clone-portal'] = true;
    else if (arg === '--all-repos-write') options['all-repos-write'] = true;
    else if (arg.startsWith('--lines=')) options.lines = arg.slice('--lines='.length);
    else if (arg.startsWith('--threshold=')) options.threshold = arg.slice('--threshold='.length);
    else if (arg.startsWith('--min-lines=')) options['min-lines'] = arg.slice('--min-lines='.length);
    else if (arg.startsWith('--bash=')) options.bash = arg.slice('--bash='.length);
    else if (arg.startsWith('--command=')) options.command = arg.slice('--command='.length);
    else if (arg.startsWith('--task-kind=')) options['task-kind'] = arg.slice('--task-kind='.length);
    else if (arg.startsWith('--model=')) options.model = arg.slice('--model='.length);
    else if (arg.startsWith('--source-lines=')) options['source-lines'] = arg.slice('--source-lines='.length);
    else if (arg.startsWith('--returned-lines=')) options['returned-lines'] = arg.slice('--returned-lines='.length);
    else if (arg.startsWith('--targeted=')) options.targeted = arg.slice('--targeted='.length);
  }
  return options;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/token-shunt-honesty.js [options]

Spotify Portal FORMAT: intercept untargeted bulk reads.
Does not install shunt@portal or buy Portal.

Options:
  --lines=N --targeted
  --bash='cat file.js'
  --task-kind=architecture --model=gemini-flash
  --source-lines=N --returned-lines=N
  --clone-portal     Fail closed
  --all-repos-write  Warn: GitHub App is not cash
  --json --strict
`);
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return 0;
  }
  const options = parseArgv(argv);
  const report = buildTokenShuntHonestyReport(options);
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatTokenShuntHonestyReport(report));
  if (options.strict && report.status !== 'ready') return 1;
  if (report.status === 'fail') return 1;
  return 0;
}

module.exports = {
  DEFAULT_MIN_LINES,
  DEFAULT_SLICE_LINES,
  SOURCE_URLS,
  detectCloneAttempt,
  evaluateReadIntercept,
  evaluateBashRead,
  evaluateTaskRoute,
  evaluateContextReturn,
  evaluatePreToolUse,
  buildTokenShuntHonestyReport,
  formatTokenShuntHonestyReport,
  main,
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  process.exitCode = main();
}
