'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_POST = 'https://x.com/DanKornas/status/2113860880592966054';
const REPO_ROOT = path.resolve(__dirname, '..');

function redact(text) {
  return String(text ?? '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}\b/g, '[redacted]')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[redacted]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[redacted]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [redacted]');
}

function clip(text) {
  return redact(text).slice(0, 500);
}

function caseIdFrom(event) {
  const raw = String(event && event.id ? event.id : 'failure');
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return safe || 'failure';
}

function safeRelativeFile(file) {
  if (typeof file !== 'string') return null;
  const trimmed = file.trim();
  if (!trimmed || path.isAbsolute(trimmed) || trimmed.split(/[/\\]/).includes('..')) return null;
  return trimmed.slice(0, 180);
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => clip(item));
}

function specFromEvent(event) {
  const wrong = event && event.whatWentWrong ? [clip(event.whatWentWrong)] : [];
  const change = event && event.whatToChange ? [clip(event.whatToChange)] : [];
  const file = safeRelativeFile(event && event.lastAction && event.lastAction.file);
  return {
    id: caseIdFrom(event),
    prompt: clip(event && (event.context || event.prompt) || ''),
    forbiddenPatterns: wrong.filter(Boolean),
    requiredSubstrings: change.filter(Boolean),
    expectedFiles: file ? [file] : [],
  };
}

function yamlStringList(name, values, indent) {
  if (!values.length) return `${indent}${name}: []`;
  return [
    `${indent}${name}:`,
    ...values.map((value) => `${indent}  - ${JSON.stringify(value)}`),
  ].join('\n');
}

function caseYaml(spec) {
  return [
    `id: ${JSON.stringify(spec.id)}`,
    'runtime: local',
    'judge: rule_based',
    `source_post: ${JSON.stringify(SOURCE_POST)}`,
    'input:',
    `  prompt: ${JSON.stringify(spec.prompt)}`,
    'expect:',
    yamlStringList('forbidden_patterns', spec.forbiddenPatterns, '  '),
    yamlStringList('required_substrings', spec.requiredSubstrings, '  '),
    yamlStringList('expected_files_modified', spec.expectedFiles, '  '),
    'ablation:',
    '  with_skill: pending',
    '  without_skill: pending',
    'state: candidate_pending_approval',
    'decision: keep_original',
    '',
  ].join('\n');
}

function insideFeedbackDir(feedbackDir, target) {
  const root = path.resolve(feedbackDir);
  const file = path.resolve(target);
  return file === root || file.startsWith(root + path.sep);
}

function wouldLandInGit(target) {
  const file = path.resolve(target);
  if (file !== REPO_ROOT && !file.startsWith(REPO_ROOT + path.sep)) return false;
  const relative = path.relative(REPO_ROOT, file);
  return relative !== path.join('.thumbgate', 'skill-up-cases', path.basename(file));
}

function isSymlink(target) {
  try {
    return fs.lstatSync(target).isSymbolicLink();
  } catch (error) {
    return error.code !== 'ENOENT';
  }
}

function recordFailureCase(event, options = {}) {
  const spec = specFromEvent(event || {});
  const base = {
    id: spec.id,
    decision: 'keep_original',
    graded: false,
    wrote: false,
    path: null,
    reason: 'Keep the original. A skill change waits for a graded rerun that beats both the original and the no-skill run.',
  };
  if (!event || event.signal !== 'negative') {
    return { ...base, reason: 'Only a negative signal becomes a case.' };
  }
  const feedbackDir = options.feedbackDir;
  if (typeof feedbackDir !== 'string' || feedbackDir.trim() === '') {
    return { ...base, reason: 'No feedback directory was set, so no case file was written.' };
  }
  const dir = path.resolve(feedbackDir, 'skill-up-cases');
  const file = path.join(dir, `${spec.id}.yaml`);
  if (!insideFeedbackDir(feedbackDir, file) || wouldLandInGit(file) || isSymlink(dir) || isSymlink(file)) {
    return { ...base, reason: 'The case file would land in git or follow a link, so it was not written.' };
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  fs.writeFileSync(file, caseYaml(spec), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return { ...base, wrote: true, path: file };
}

function attachReproducibleCase(event, options = {}) {
  if (!event || event.signal !== 'negative') return event;
  return {
    ...event,
    reproducibleCase: recordFailureCase(event, options),
  };
}

function gradeLocalCase(spec, run) {
  const id = spec && typeof spec.id === 'string' ? spec.id : null;
  const response = String(run && run.responseText ? run.responseText : '');
  const files = Array.isArray(run && run.workspaceFiles) ? run.workspaceFiles.map(String) : [];
  const forbidden = stringList(spec && spec.forbiddenPatterns);
  const required = stringList(spec && spec.requiredSubstrings);
  const expected = stringList(spec && spec.expectedFiles);
  const row = (verdict, reason) => ({
    id,
    verdict,
    graded: true,
    source: 'local-rule',
    reason,
  });
  if (!id || (forbidden.length === 0 && required.length === 0 && expected.length === 0)) {
    return row('FAIL', 'vacuous');
  }
  for (const pattern of forbidden) {
    if (response.includes(pattern)) return row('FAIL', 'forbidden_pattern');
  }
  for (const needle of required) {
    if (!response.includes(needle)) return row('FAIL', 'missing_substring');
  }
  for (const file of expected) {
    if (!files.includes(file)) return row('FAIL', 'missing_file');
  }
  return row('PASS', null);
}

function passRate(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const ids = [];
  let passes = 0;
  for (const row of rows) {
    if (!row || row.graded !== true || row.source !== 'local-rule') return null;
    if (row.verdict !== 'PASS' && row.verdict !== 'FAIL') return null;
    if (typeof row.id !== 'string' || row.id === '') return null;
    ids.push(row.id);
    if (row.verdict === 'PASS') passes += 1;
  }
  return { rate: passes / rows.length, ids };
}

function sameIds(left, right) {
  if (left.ids.length !== right.ids.length) return false;
  const a = [...left.ids].sort();
  const b = [...right.ids].sort();
  return a.every((id, index) => id === b[index]);
}

function decideEvolution(input = {}) {
  const original = passRate(input.originalCases);
  const without = passRate(input.withoutSkillCases);
  const candidate = passRate(input.candidateCases);
  const aligned = Boolean(original && without && candidate && sameIds(original, without) && sameIds(original, candidate));
  const promote = aligned && candidate.rate > original.rate && candidate.rate > without.rate;
  return {
    decision: promote ? 'promote_candidate' : 'keep_original',
    graded: aligned,
    originalPassRate: aligned ? original.rate : null,
    withoutSkillPassRate: aligned ? without.rate : null,
    candidatePassRate: aligned ? candidate.rate : null,
  };
}

module.exports = {
  SOURCE_POST,
  redact,
  recordFailureCase,
  attachReproducibleCase,
  gradeLocalCase,
  decideEvolution,
  caseYaml,
  specFromEvent,
};
