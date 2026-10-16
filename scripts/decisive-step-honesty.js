#!/usr/bin/env node
'use strict';

/**
 * Decisive-step FORMAT on the existing attribution rail.
 *
 * Source: https://arxiv.org/abs/2610.10478
 *
 * When a verifier result is on the action log, score only the first code
 * edit that flips tests from fail to pass. Steps before it are context.
 * Steps after the certifying pass are cleanup. The judge is the verifier.
 *
 * Does not install Nvidia weights. Does not train a base model.
 * The paper's correlation stays the paper's.
 */

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_URL = 'https://arxiv.org/abs/2610.10478';
const GATE_ID = 'score-decisive-edit-only';

const EDIT_TOOLS = new Set([
  'edit',
  'write',
  'multiedit',
  'apply_patch',
  'patch',
  'strreplace',
  'search_replace',
]);

const ALL_STEP_RE = /\b(?:score|average|scoring)\s+(?:every|each|all)\s+steps?\b|\ball-step ranking\b/i;
const BORROWED_RE = /\b(?:our|thumbgate(?:'s)?|we)\s+(?:(?:measured|scored|achieved|got)\s+)?0\.964\b|\b0\.964\s+is\s+our\b/i;
const NVIDIA_TRAIN_RE = /nemo-aligner|openrlhf|install nvidia weights|train the base model/i;
const QUIZ_PHRASES = Object.freeze([
  'Rank agents by HumanEval',
  'MBPP is our agent ranking',
  'simple coding test as the agent ranking',
  'HumanEval as the agent ranking',
]);

const RAIL_MAP = Object.freeze([
  {
    paper: 'Score only the first edit that flips tests from fail to pass',
    thumbgate: 'Attribution selects that edit when a verifier result is on the action log',
  },
  {
    paper: 'Steps before the decisive edit are prefix context',
    thumbgate: 'Prefix steps stay context and are not the attributed edit',
  },
  {
    paper: 'Steps after the pass are cleanup',
    thumbgate: 'Cleanup after the certifying pass is ignored',
  },
  {
    paper: 'The judge is the test suite',
    thumbgate: 'The verifier decides. Lexical overlap does not',
  },
  {
    paper: 'A coding quiz is not an agent ranking',
    thumbgate: 'HumanEval and MBPP phrases used as the agent ranking fail closed',
  },
  {
    paper: 'The paper reports its own correlation',
    thumbgate: 'That correlation is not a ThumbGate result',
  },
]);

function normalizeBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function finding(id, message) {
  return { id, severity: 'fail', gateId: GATE_ID, message };
}

function dedupe(findings) {
  const seen = new Set();
  const out = [];
  for (const item of findings) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function isCodeEdit(step) {
  if (!step || typeof step !== 'object') return false;
  if (step.edit === true) return true;
  const names = [step.tool, step.kind, step.tool_name];
  for (const name of names) {
    if (typeof name !== 'string') continue;
    if (EDIT_TOOLS.has(name.trim().toLowerCase())) return true;
  }
  return false;
}

function classifyVerdict(value) {
  if (value == null) return null;
  if (typeof value === 'boolean') return value ? 'pass' : 'fail';
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (text === 'pass' || text === 'passed' || text === 'ok' || text === 'true') return 'pass';
    if (text === 'fail' || text === 'failed' || text === 'error' || text === 'false') return 'fail';
    return null;
  }
  if (typeof value === 'object') {
    if (value.passed === true) return 'pass';
    if (value.passed === false) return 'fail';
    const status = typeof value.status === 'string' ? value.status.trim().toLowerCase() : '';
    if (status === 'pass' || status === 'passed') return 'pass';
    if (status === 'fail' || status === 'failed') return 'fail';
    return null;
  }
  return null;
}

function readVerdict(step) {
  if (!step || typeof step !== 'object') return null;
  const keys = ['verifier', 'tests', 'testResult'];
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(step, key)) {
      return classifyVerdict(step[key]);
    }
  }
  return null;
}

function findDecisiveStep(steps) {
  if (!Array.isArray(steps)) return null;
  let seenFail = false;
  let candidate = null;
  let candidateIndex = -1;
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (!step || typeof step !== 'object') continue;
    const verdict = readVerdict(step);
    const edit = isCodeEdit(step);
    if (verdict === 'fail') {
      seenFail = true;
      candidate = null;
      candidateIndex = -1;
      continue;
    }
    if (verdict === 'pass') {
      if (!seenFail) return null;
      if (edit) return { step, index: i, certifiedAt: i, prefixCount: i };
      if (!candidate) return null;
      return {
        step: candidate,
        index: candidateIndex,
        certifiedAt: i,
        prefixCount: candidateIndex,
      };
    }
    if (edit && seenFail) {
      candidate = step;
      candidateIndex = i;
    }
  }
  return null;
}

function scanClaim(text, findings) {
  const claim = text == null ? '' : String(text);
  if (!claim) return;
  if (ALL_STEP_RE.test(claim)) {
    findings.push(finding(
      'all_step_score',
      'Score only the first edit that flips tests from fail to pass. Do not score every step.'
    ));
  }
  for (const phrase of QUIZ_PHRASES) {
    if (claim.includes(phrase)) {
      findings.push(finding('coding_quiz_rank', 'A coding quiz is not an agent ranking.'));
      break;
    }
  }
  if (BORROWED_RE.test(claim)) {
    findings.push(finding(
      'borrowed_correlation',
      'The paper\'s correlation stays the paper\'s. Do not claim it as a ThumbGate result.'
    ));
  }
  if (NVIDIA_TRAIN_RE.test(claim)) {
    findings.push(finding(
      'nvidia_train',
      'Do not install Nvidia weights or train a base model.'
    ));
  }
}

function loadTrace(value) {
  if (value == null || value === '' || value === false || value === true) {
    return { error: true };
  }
  const text = String(value).trim();
  if (!text) return { error: true };
  let raw = text;
  if (!(text.startsWith('[') || text.startsWith('{'))) {
    try {
      raw = fs.readFileSync(text, 'utf8');
    } catch (error) {
      return { error: true, message: error.message };
    }
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { error: true, message: error.message };
  }
  if (Array.isArray(parsed)) return { steps: parsed };
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.steps)) return { steps: parsed.steps };
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.actions)) return { steps: parsed.actions };
  return { error: true };
}

function traceWasSupplied(options) {
  if (Object.prototype.hasOwnProperty.call(options, 'steps')
    && options.steps !== false
    && options.steps != null
    && options.steps !== '') {
    return true;
  }
  const trace = options.trace;
  return trace != null && trace !== '' && trace !== false;
}

function buildDecisiveStepHonestyReport(rawOptions = {}) {
  const options = rawOptions || {};
  const mapOnly = normalizeBoolean(options['map-only'] || options.mapOnly);
  const claim = options.claim == null || options.claim === true ? '' : String(options.claim);
  const findings = [];
  let decisiveStep = null;
  const supplied = traceWasSupplied(options);

  if (supplied) {
    const useSteps = Object.prototype.hasOwnProperty.call(options, 'steps')
      && options.steps !== false
      && options.steps != null
      && options.steps !== '';
    if (useSteps) {
      if (!Array.isArray(options.steps)) {
        findings.push(finding(
          'trace_unreadable',
          'Trace did not parse. Pass a JSON array, {steps:[]}, {actions:[]}, or a readable file path.'
        ));
        decisiveStep = null;
      } else {
        decisiveStep = findDecisiveStep(options.steps);
      }
    } else {
      const loaded = loadTrace(options.trace);
      if (loaded.error) {
        findings.push(finding(
          'trace_unreadable',
          'Trace did not parse. Pass a JSON array, {steps:[]}, {actions:[]}, or a readable file path.'
        ));
        decisiveStep = null;
      } else {
        decisiveStep = findDecisiveStep(loaded.steps);
      }
    }
  }

  scanClaim(claim, findings);

  const deduped = dedupe(findings);
  const failCount = deduped.filter((item) => item.severity === 'fail').length;
  const status = failCount > 0 ? 'fail' : 'ready';
  return {
    name: 'thumbgate-decisive-step-honesty',
    source: SOURCE_URL,
    sourceDocs: [SOURCE_URL],
    status,
    ok: status === 'ready',
    mapOnly,
    map: RAIL_MAP,
    decisiveStep,
    findings: deduped,
    summary: { failCount, findingCount: deduped.length },
    recommendedGates: [GATE_ID],
    nextActions: [
      'Attribute feedback only to the first code edit a verifier flips from fail to pass.',
      'Steps before that edit are context. Steps after the certifying pass are cleanup.',
      'Refuse a coding quiz as an agent ranking.',
      'Cite https://arxiv.org/abs/2610.10478. The paper\'s correlation stays the paper\'s.',
      'Do not install Nvidia weights, train a base model, or score every step.',
    ],
    exampleCommand: 'npx thumbgate decisive-step-honesty --json --map-only',
    disclaimer: 'Score only the first code edit a verifier flips from fail to pass. The paper\'s correlation stays the paper\'s. Does not train a model.',
  };
}

function formatDecisiveStepHonestyReport(report) {
  const lines = [
    '',
    'ThumbGate Decisive-Step Honesty Doctor',
    '-'.repeat(48),
    `Status : ${report.status}`,
    `Source : ${report.source}`,
    `Decisive step: ${report.decisiveStep ? `index ${report.decisiveStep.index}` : '(none)'}`,
    `Findings: ${report.summary.findingCount} (fail=${report.summary.failCount})`,
    '',
    'Rail map:',
  ];
  for (const row of report.map) lines.push(`  - ${row.paper} → ${row.thumbgate}`);
  if (report.findings.length) {
    lines.push('', 'Findings:');
    for (const item of report.findings) {
      lines.push(`  - [${item.severity}] ${item.id} [${item.gateId}]`);
      lines.push(`    ${item.message}`);
    }
  }
  lines.push('', 'Next actions:');
  for (const action of report.nextActions) lines.push(`  - ${action}`);
  lines.push('', `Example: ${report.exampleCommand}`);
  lines.push(`Note: ${report.disclaimer}`, '');
  return `${lines.join('\n')}\n`;
}

function parseCliArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (arg === '--json') { options.json = true; continue; }
    if (arg === '--strict') { options.strict = true; continue; }
    if (arg === '--map-only') { options['map-only'] = true; continue; }
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!match) continue;
    options[match[1]] = match[2] === undefined ? true : match[2];
  }
  return options;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/decisive-step-honesty.js [flags]

Flags:
  --claim=TEXT       Claim to audit
  --trace=PATH       JSON steps, or a file with an array, steps, or actions
  --map-only         Print the paper → ThumbGate rail map
  --json --strict

Source: ${SOURCE_URL}
Does not train a model.
`);
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  const report = buildDecisiveStepHonestyReport(args);
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatDecisiveStepHonestyReport(report));
  if (args.strict && report.status !== 'ready') return 1;
  if (report.status === 'fail') return 1;
  return 0;
}

module.exports = {
  SOURCE_URL,
  GATE_ID,
  RAIL_MAP,
  findDecisiveStep,
  buildDecisiveStepHonestyReport,
  formatDecisiveStepHonestyReport,
  runCli,
};

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  process.exitCode = runCli();
}
