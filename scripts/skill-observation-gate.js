#!/usr/bin/env node
'use strict';

/**
 * Local skill-eval gate stolen from Dan Kornas / alibaba skill-up (2026-10-24).
 *
 * Their idea: a skill improves when a failure can be rerun. Failure rules are
 * checked first, an observation becomes a regression case only after explicit
 * approval, and a candidate is kept only when the same cases still pass.
 *
 * This file does not install skill-up, start Docker or OpenSandbox, or call a model.
 * Source: https://x.com/DanKornas/status/2113860880592966054
 *         https://github.com/alibaba/skill-up
 */

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_POST = 'https://x.com/DanKornas/status/2113860880592966054';
const SOURCE_REPO = 'https://github.com/alibaba/skill-up';

const LOCAL_RULES = new Set(['skill_contains', 'skill_not_contains', 'file_exists']);
const REFUSED_RULES = new Set(['command', 'routes_to', 'routes_in_top', 'agent_judge', 'script']);
const REFUSED_RUNTIMES = new Set(['docker', 'opensandbox', 'open-sandbox']);
const REFUSED_JUDGES = new Set(['agent_judge', 'agent', 'script', 'user_simulator']);

function refuse(code, message) {
  return { admitted: false, code, message, case: null };
}

function ruleShape(rule) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    return { ok: false, code: 'rule_shape', message: 'Each rule must be an object with one key.' };
  }
  const keys = Object.keys(rule);
  if (keys.length !== 1) {
    return { ok: false, code: 'rule_shape', message: 'Each rule must have exactly one key.' };
  }
  const key = keys[0];
  if (REFUSED_RULES.has(key)) {
    return {
      ok: false,
      code: 'rule_refused',
      message: `Rule "${key}" is not run here. It needs a model or a shell.`,
    };
  }
  if (!LOCAL_RULES.has(key)) {
    return { ok: false, code: 'rule_unknown', message: `Rule "${key}" is not a known local rule.` };
  }
  const value = rule[key];
  if (typeof value !== 'string' || value.trim() === '') {
    return { ok: false, code: 'rule_shape', message: `Rule "${key}" needs a non-empty string.` };
  }
  if (key === 'file_exists' && (path.isAbsolute(value) || value.split(/[/\\]/).includes('..'))) {
    return {
      ok: false,
      code: 'rule_shape',
      message: 'file_exists must be a relative path inside the workspace.',
    };
  }
  return { ok: true, key, value };
}

function normalizeJudge(judge) {
  if (!judge || typeof judge !== 'object' || Array.isArray(judge)) {
    return {
      ok: false,
      code: 'vacuous_judge',
      message: 'A case needs judge.failure or judge.success. An empty judge cannot pass.',
    };
  }
  const failure = Array.isArray(judge.failure) ? judge.failure : [];
  const success = Array.isArray(judge.success) ? judge.success : [];
  if (judge.failure != null && !Array.isArray(judge.failure)) {
    return { ok: false, code: 'rule_shape', message: 'judge.failure must be an array when present.' };
  }
  if (judge.success != null && !Array.isArray(judge.success)) {
    return { ok: false, code: 'rule_shape', message: 'judge.success must be an array when present.' };
  }
  if (failure.length === 0 && success.length === 0) {
    return { ok: false, code: 'vacuous_judge', message: 'A case with no rules cannot pass.' };
  }
  for (const rule of failure.concat(success)) {
    const shaped = ruleShape(rule);
    if (!shaped.ok) return shaped;
  }
  return { ok: true, judge: { failure, success } };
}

function admitObservation(observation) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
    return refuse('invalid_observation', 'Observation must be an object.');
  }
  const runtime = observation.runtime == null ? 'local' : String(observation.runtime);
  if (REFUSED_RUNTIMES.has(runtime) || (runtime !== 'local' && runtime !== 'none')) {
    return refuse('runtime_refused', `Runtime "${runtime}" is not used. Cases stay on the local tree.`);
  }
  const judgeType = observation.judgeType == null ? 'rule_based' : String(observation.judgeType);
  if (judgeType !== 'rule_based' || REFUSED_JUDGES.has(judgeType)) {
    return refuse('judge_refused', `Judge "${judgeType}" is not used. Only rule_based runs here.`);
  }
  if (observation.approved !== true) {
    return refuse('approval_required', 'An observation becomes a regression case only after approved is true.');
  }
  if (observation.attribution !== 'explicit') {
    return refuse('explicit_attribution_required', 'Attribution must be the string explicit.');
  }
  if (typeof observation.approvedBy !== 'string' || observation.approvedBy.trim() === '') {
    return refuse('approver_required', 'approvedBy must name the person who approved the case.');
  }
  const testCase = observation.case;
  if (!testCase || typeof testCase !== 'object' || Array.isArray(testCase)) {
    return refuse('case_required', 'An approved observation needs a case object.');
  }
  if (typeof testCase.id !== 'string' || testCase.id.trim() === '') {
    return refuse('case_id_required', 'case.id must be a non-empty string.');
  }
  const judge = normalizeJudge(testCase.judge);
  if (!judge.ok) return refuse(judge.code, judge.message);
  const prompt = testCase.input && typeof testCase.input === 'object'
    ? String(testCase.input.prompt || '')
    : '';
  return {
    admitted: true,
    code: null,
    message: 'Observation admitted as a regression case.',
    case: {
      id: testCase.id.trim(),
      title: typeof testCase.title === 'string' && testCase.title.trim()
        ? testCase.title.trim()
        : testCase.id.trim(),
      input: { prompt },
      judge: judge.judge,
      source: 'approved-observation',
      approvedBy: observation.approvedBy.trim(),
      attribution: 'explicit',
    },
  };
}

function skillTextOf(workspace) {
  if (!workspace || typeof workspace.skillText !== 'string') return '';
  return workspace.skillText;
}

function insideRoot(rootReal, candidateReal) {
  return candidateReal === rootReal || candidateReal.startsWith(rootReal + path.sep);
}

function fileExists(workspace, relativePath) {
  const files = workspace && workspace.files && typeof workspace.files === 'object'
    ? workspace.files
    : null;
  if (files && Object.prototype.hasOwnProperty.call(files, relativePath)) return true;
  if (!workspace || typeof workspace.root !== 'string' || workspace.root === '') return false;
  const base = path.resolve(workspace.root);
  const target = path.resolve(base, relativePath);
  if (target !== base && !target.startsWith(base + path.sep)) return false;
  let rootReal;
  try {
    rootReal = fs.realpathSync(base);
  } catch {
    return false;
  }
  let real;
  try {
    real = fs.realpathSync(target);
  } catch {
    return false;
  }
  if (!insideRoot(rootReal, real)) return false;
  try {
    return fs.statSync(real).isFile();
  } catch {
    return false;
  }
}

function predicateHolds(rule, workspace) {
  const key = Object.keys(rule)[0];
  const expected = rule[key];
  if (key === 'skill_contains') return skillTextOf(workspace).includes(expected);
  if (key === 'skill_not_contains') return !skillTextOf(workspace).includes(expected);
  if (key === 'file_exists') return fileExists(workspace, expected);
  return false;
}

function judgeCase(testCase, workspace) {
  const id = testCase && typeof testCase.id === 'string' ? testCase.id : null;
  const normalized = normalizeJudge(testCase && testCase.judge);
  if (!normalized.ok) {
    return {
      id,
      verdict: 'FAIL',
      code: normalized.code,
      message: normalized.message,
      failureCheckedFirst: true,
    };
  }
  for (const rule of normalized.judge.failure) {
    if (predicateHolds(rule, workspace || {})) {
      return {
        id,
        verdict: 'FAIL',
        code: 'failure_rule',
        message: 'A failure rule matched before success rules were applied.',
        rule,
        failureCheckedFirst: true,
      };
    }
  }
  for (const rule of normalized.judge.success) {
    if (!predicateHolds(rule, workspace || {})) {
      return {
        id,
        verdict: 'FAIL',
        code: 'success_rule',
        message: 'A success rule did not hold.',
        rule,
        failureCheckedFirst: true,
      };
    }
  }
  return {
    id,
    verdict: 'PASS',
    code: null,
    message: 'Failure rules were clear and every success rule held.',
    failureCheckedFirst: true,
  };
}

function casesOf(report) {
  if (Array.isArray(report)) return report;
  if (!report || typeof report !== 'object' || Array.isArray(report)) return null;
  if (!Array.isArray(report.cases)) return null;
  return report.cases;
}

function compareRuns(baseline, candidate) {
  const baseCases = casesOf(baseline);
  const nextCases = casesOf(candidate);
  if (!baseCases || !nextCases) {
    return {
      decision: 'keep_original',
      code: 'invalid_report',
      regressions: [],
      message: 'Both runs need a cases array.',
    };
  }
  const nextById = new Map();
  for (const row of nextCases) {
    if (!row || typeof row.id !== 'string' || row.id.trim() === '') continue;
    nextById.set(row.id, row.verdict);
  }
  const regressions = [];
  for (const row of baseCases) {
    if (!row || typeof row.id !== 'string' || row.id.trim() === '') {
      regressions.push({ id: null, from: null, to: 'removed' });
      continue;
    }
    if (!nextById.has(row.id)) {
      regressions.push({ id: row.id, from: row.verdict || null, to: 'removed' });
      continue;
    }
    if (row.verdict === 'PASS' && nextById.get(row.id) !== 'PASS') {
      regressions.push({ id: row.id, from: 'PASS', to: nextById.get(row.id) || 'missing' });
    }
  }
  if (regressions.length > 0) {
    return {
      decision: 'keep_original',
      code: 'regression',
      regressions,
      message: 'The candidate dropped a case or turned a pass into a non-pass. Keep the original.',
    };
  }
  return {
    decision: 'accept',
    code: null,
    regressions: [],
    message: 'Every previous case is still present and every previous pass still passes.',
  };
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

function toJUnit(results) {
  const rows = Array.isArray(results) ? results : [];
  const failures = rows.filter((row) => !row || row.verdict !== 'PASS').length;
  const body = rows.map((row) => {
    const name = escapeXml(row && row.id ? row.id : 'case');
    if (row && row.verdict === 'PASS') return `    <testcase name="${name}"/>`;
    const message = escapeXml((row && (row.message || row.code)) || 'FAIL');
    return `    <testcase name="${name}">\n      <failure message="${message}"/>\n    </testcase>`;
  }).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="skill-observation-gate" tests="${rows.length}" failures="${failures}">`,
    body,
    '</testsuite>',
    '',
  ].join('\n');
}

function ideaMap() {
  return {
    sourcePost: SOURCE_POST,
    sourceRepo: SOURCE_REPO,
    code: 'scripts/skill-observation-gate.js',
    taken: [
      'failure rules are checked before success rules',
      'an observation becomes a regression case only after explicit approval',
      'a revision is kept only when no case disappears and no pass becomes a non-pass',
    ],
    refused: [
      'install skill-up',
      'docker',
      'opensandbox',
      'agent judge',
      'user simulator',
      'newsletter signup',
      'replying on X',
    ],
    notOurMeasurement: true,
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function safeOutPath(cwd, out) {
  if (typeof out !== 'string' || out === '' || path.isAbsolute(out) || out.split(/[/\\]/).includes('..')) {
    return null;
  }
  const base = path.resolve(cwd);
  const target = path.resolve(base, out);
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  process.stderr.write(
    'Usage: node scripts/skill-observation-gate.js <admit|judge|compare|--map-only>\n'
    + '  admit                 read an observation JSON object from stdin\n'
    + '  admit --out case.json write the case only when it is admitted\n'
    + '  judge --case file.json [--workspace dir]\n'
    + '  compare baseline.json candidate.json\n',
  );
}

function main(argv, stdin, cwd) {
  const args = argv.slice(2);
  if (args.includes('--map-only') || args[0] === '--map-only') {
    printJson(ideaMap());
    return 0;
  }
  const command = args[0];
  if (command === 'admit') {
    let observation;
    try {
      observation = JSON.parse(stdin || '');
    } catch {
      printJson(refuse('invalid_json', 'stdin must be one JSON object.'));
      return 2;
    }
    const result = admitObservation(observation);
    const outFlag = args.indexOf('--out');
    if (outFlag !== -1) {
      const target = safeOutPath(cwd, args[outFlag + 1]);
      if (!target) {
        printJson(refuse('out_refused', '--out must be a relative path inside the working directory.'));
        return 2;
      }
      if (result.admitted) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, `${JSON.stringify(result.case, null, 2)}\n`);
      }
    }
    printJson(result);
    return result.admitted ? 0 : 1;
  }
  if (command === 'judge') {
    const caseFlag = args.indexOf('--case');
    if (caseFlag === -1 || !args[caseFlag + 1]) {
      usage();
      return 2;
    }
    let testCase;
    try {
      testCase = readJson(args[caseFlag + 1]);
    } catch {
      printJson({ verdict: 'FAIL', code: 'invalid_json', message: 'Could not read the case file.', failureCheckedFirst: true });
      return 2;
    }
    const workspaceFlag = args.indexOf('--workspace');
    const workspace = { skillText: '', files: Object.create(null) };
    if (workspaceFlag !== -1 && args[workspaceFlag + 1]) {
      const root = path.resolve(cwd, args[workspaceFlag + 1]);
      workspace.root = root;
      const skillFile = path.join(root, 'SKILL.md');
      if (fs.existsSync(skillFile) && fs.statSync(skillFile).isFile()) {
        workspace.skillText = fs.readFileSync(skillFile, 'utf8');
      }
    }
    const result = judgeCase(testCase, workspace);
    printJson(result);
    return result.verdict === 'PASS' ? 0 : 1;
  }
  if (command === 'compare') {
    if (!args[1] || !args[2]) {
      usage();
      return 2;
    }
    let baseline;
    let candidate;
    try {
      baseline = readJson(args[1]);
      candidate = readJson(args[2]);
    } catch {
      printJson({
        decision: 'keep_original',
        code: 'invalid_json',
        regressions: [],
        message: 'Could not read both report files.',
      });
      return 2;
    }
    const result = compareRuns(baseline, candidate);
    printJson(result);
    return result.decision === 'accept' ? 0 : 1;
  }
  usage();
  return 2;
}

module.exports = {
  SOURCE_POST,
  SOURCE_REPO,
  admitObservation,
  judgeCase,
  compareRuns,
  toJUnit,
  ideaMap,
  main,
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const stdin = fs.readFileSync(0, 'utf8');
  process.exit(main(process.argv, stdin, process.cwd()));
}
