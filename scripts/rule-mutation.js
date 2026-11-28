#!/usr/bin/env node
'use strict';

// Able-to-fail testing for learned rules. A learned rule stores the command a person thumbed down as literal text,
// so the same action written another way (rm -fr, find -delete, shutil.rmtree, git push +main) slipped past it.
// When a rule is learned, this writes reworded variants of the command, runs each through the real gate matcher,
// and, when some get past, records what the command does (its intent: delete this path, force-push this branch, or
// these words after the usual wrappers) so the gate also matches the variants. The result is kept on the gate as
// `mutationAudit` so the dashboard and `thumbgate rule-test` can show how many variants the rule now catches.
//
// Law 12 (new gates ship warn-only): a call that matches only through the intent, not the learned text, is a
// warning unless THUMBGATE_INTENT_GATES=enforce. The learned text itself keeps its block.
//
// Not covered, on purpose: paths built at run time ($VAR, os.path.join), scripts the gate cannot read
// (sh cleanup.sh), moving a folder away instead of deleting it, and a parent folder of the learned path.

const path = require('node:path');
const deleteEquivalence = require('./delete-equivalence');

const INTENT_ENV = 'THUMBGATE_INTENT_GATES';

function intentEnforced() {
  return String(process.env[INTENT_ENV] || '').toLowerCase() === 'enforce';
}

function unescapePattern(pattern) {
  return String(pattern || '').replace(/\\(.)/g, '$1');
}

// The command a learned gate was made from. Only learned gates: hand-written regexes are not literal commands.
function learnedCommand(gate) {
  if (!gate || typeof gate.pattern !== 'string' || gate.surfaceDerived || gate.condition) return '';
  const learned = gate.source === 'force-promote' || gate.source === 'auto-promote' || /^auto:/.test(String(gate.trigger || ''));
  return learned ? unescapePattern(gate.pattern).trim() : '';
}

// Shell text plus the text inside `bash -c "..."`, `sh -c '...'` and `eval "..."`, one level deep.
function unwrapShell(command) {
  const text = String(command || '');
  const out = [text];
  const re = /\b(?:(?:ba|z|da|k)?sh\s+(?:-[a-z]*c[a-z]*|-c)|eval)\s+(["'])((?:(?!\1)[^\\]|\\.)*)\1/g;
  let m;
  while ((m = re.exec(text))) out.push(m[2].replace(/\\(["\\$`])/g, '$1'));
  return out;
}

function segments(command) {
  return unwrapShell(command).flatMap((text) => text.split(/(?:&&|\|\||[;|\n])+/)).map((s) => s.trim()).filter(Boolean);
}

function words(segment) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(segment))) out.push(m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]));
  // Leading wrappers that do not change what runs.
  while (out.length && (/^(?:sudo|command|exec|nice|nohup|time|env)$/.test(out[0]) || /^\w+=/.test(out[0]) || (out[0] === '-n' || /^-\d+$/.test(out[0])))) out.shift();
  return out;
}

// ---- recursive delete --------------------------------------------------------------------------------------

function findTargets(command) {
  const targets = [];
  for (const segment of segments(command)) {
    const w = words(segment);
    if (path.posix.basename(w[0] || '') !== 'find') continue;
    const deletes = w.includes('-delete') || w.some((word, i) => (word === '-exec' || word === '-execdir') && /(?:^|\/)(?:rm|unlink|rmdir)$/.test(w[i + 1] || ''));
    if (!deletes) continue;
    for (const word of w.slice(1)) {
      if (word.startsWith('-') || word === '!' || word === '(') break;
      const target = deleteEquivalence.normalizePath(word);
      if (target) targets.push(target);
    }
  }
  return targets;
}

function rsyncDeleteTargets(command) {
  const targets = [];
  for (const segment of segments(command)) {
    const w = words(segment);
    if (path.posix.basename(w[0] || '') !== 'rsync' || !w.some((word) => /^--delete/.test(word))) continue;
    const positional = w.slice(1).filter((word) => !word.startsWith('-'));
    if (positional.length >= 2) {
      const target = deleteEquivalence.normalizePath(positional[positional.length - 1]);
      if (target) targets.push(target);
    }
  }
  return targets;
}

const NODE_DELETE = /\b(?:(?:fs|fsp|promises|fse|fsExtra)\s*\.\s*(?:rmSync|rmdirSync|rm|rmdir|removeSync|remove|emptyDirSync)|rimraf(?:\s*\.\s*sync)?|require\(\s*['"](?:node:)?fs['"]\s*\)\s*\.\s*(?:rmSync|rmdirSync|rm|rmdir))\s*\(\s*(['"`])([^'"`\n$]+)\1/g;

function nodeDeleteTargets(text) {
  const targets = [];
  NODE_DELETE.lastIndex = 0;
  let m;
  while ((m = NODE_DELETE.exec(String(text || '')))) {
    const target = deleteEquivalence.normalizePath(m[2]);
    if (target) targets.push(target);
  }
  return targets;
}

function shellRmTargets(command) {
  return segments(command).flatMap((segment) => deleteEquivalence.shellDeleteTargets(segment));
}

function toolText(toolInput) {
  if (!toolInput) return '';
  if (toolInput.command) {
    const command = String(toolInput.command);
    const unescaped = command.replace(/\\(["\\$`])/g, '$1');
    return unescaped === command ? command : `${command}\n${unescaped}`;
  }
  return String(toolInput.content || toolInput.new_string || toolInput.new_str || '');
}

// Every path this tool call deletes that can be read from its text.
function deleteTargetsOf(toolName, toolInput) {
  const text = toolText(toolInput);
  if (!text) return [];
  const isShell = Boolean(toolInput && toolInput.command);
  const targets = [];
  if (isShell) targets.push(...shellRmTargets(text), ...findTargets(text), ...rsyncDeleteTargets(text));
  targets.push(...deleteEquivalence.pythonDeleteTargets(text), ...nodeDeleteTargets(text));
  return [...new Set(targets)];
}

// ---- force push --------------------------------------------------------------------------------------------

function gitPushArgs(segment) {
  const w = words(segment);
  if (path.posix.basename(w[0] || '') !== 'git') return null;
  let i = 1;
  while (i < w.length && w[i].startsWith('-')) i += (w[i] === '-C' || w[i] === '-c' || w[i] === '--git-dir' || w[i] === '--work-tree') ? 2 : 1;
  if (w[i] !== 'push') return null;
  return w.slice(i + 1);
}

function forcePushesOf(command) {
  const pushes = [];
  for (const segment of segments(command)) {
    const args = gitPushArgs(segment);
    if (!args) continue;
    const flagForce = args.some((a) => /^--force(?:-with-lease|-if-includes)?(?:=|$)/.test(a) || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a));
    const positional = args.filter((a) => !a.startsWith('-'));
    const refspecs = positional.slice(1);
    const plus = refspecs.some((r) => r.startsWith('+'));
    if (!flagForce && !plus) continue;
    const branches = refspecs.map((r) => r.replace(/^\+/, '').split(':').pop().replace(/^refs\/heads\//, '')).filter(Boolean);
    pushes.push({ branches });
  }
  return pushes;
}

// ---- normalized words (any other learned command) ----------------------------------------------------------

function normalizedWords(command) {
  return segments(command).map((segment) => words(segment).join(' ')).filter(Boolean);
}

// ---- intent ------------------------------------------------------------------------------------------------

// What a learned command does, in a form other spellings of the same action can be compared with.
function intentFor(command) {
  const text = String(command || '').trim();
  if (!text) return null;
  const targets = deleteTargetsOf('Bash', { command: text });
  if (targets.length && /\b(?:rm|rmdir|unlink|find|rsync|shutil|rmSync|rimraf)\b/.test(text)) {
    return { kind: 'delete-path', targets };
  }
  const pushes = forcePushesOf(text);
  if (pushes.length) {
    const branches = [...new Set(pushes.flatMap((p) => p.branches))];
    return { kind: 'force-push', branches };
  }
  const normalized = normalizedWords(text);
  if (normalized.length === 1 && normalized[0].split(' ').length >= 2) return { kind: 'command-words', words: normalized[0] };
  return null;
}

function intentMatches(gate, toolName, toolInput) {
  const intent = gate && gate.intent;
  if (!intent || !toolInput) return false;
  if (intent.kind === 'delete-path') {
    const attempted = new Set(deleteTargetsOf(toolName, toolInput));
    return (intent.targets || []).some((t) => attempted.has(t));
  }
  if (intent.kind === 'force-push') {
    if (!toolInput.command) return false;
    const pushes = forcePushesOf(toolText(toolInput));
    if (!pushes.length) return false;
    const wanted = intent.branches || [];
    if (!wanted.length) return true;
    return pushes.some((p) => p.branches.some((b) => wanted.includes(b)));
  }
  if (intent.kind === 'command-words') {
    if (!toolInput.command) return false;
    const want = String(intent.words || '');
    return Boolean(want) && normalizedWords(toolText(toolInput)).some((seg) => seg === want || seg.startsWith(`${want} `));
  }
  return false;
}

// ---- variants ----------------------------------------------------------------------------------------------

function quoteFor(target, raw) {
  return raw || target;
}

// Reworded versions of a learned command: same action, different spelling. Each is [label, command].
function variantsFor(command) {
  const text = String(command || '').trim();
  const intent = intentFor(text);
  const out = [];
  if (intent && intent.kind === 'delete-path') {
    const raw = (words(segments(text)[0] || '').filter((w) => !w.startsWith('-')).slice(1)[0]) || intent.targets[0];
    const t = quoteFor(intent.targets[0], raw);
    out.push(
      ['rm, flags swapped', `rm -fr ${t}`],
      ['rm, flags split', `rm -r -f ${t}`],
      ['rm, long flags', `rm --recursive --force ${t}`],
      ['rm, path quoted', `rm -rf "${t}"`],
      ['chained after cd', `cd . && rm -rf ${t}`],
      ['wrapped in bash -c', `bash -c "rm -rf ${t}"`],
      ['find -delete', `find ${t} -delete`],
      ['find -exec rm', `find ${t} -type f -exec rm -f {} +`],
      ['python shutil.rmtree', `python3 -c "import shutil; shutil.rmtree('${t}')"`],
      ['node fs.rmSync', `node -e "require('fs').rmSync('${t}',{recursive:true,force:true})"`],
      ['rsync --delete from empty dir', `rsync -a --delete /tmp/empty/ ${t}`],
    );
  } else if (intent && intent.kind === 'force-push') {
    const b = intent.branches[0] || 'main';
    out.push(
      ['short -f flag', `git push -f origin ${b}`],
      ['long --force flag', `git push --force origin ${b}`],
      ['--force-with-lease', `git push --force-with-lease origin ${b}`],
      ['+refspec', `git push origin +${b}`],
      ['+HEAD:refspec', `git push origin +HEAD:${b}`],
      ['git -C dir', `git -C . push --force origin ${b}`],
      ['wrapped in bash -c', `bash -c "git push --force origin ${b}"`],
    );
  } else if (text) {
    out.push(
      ['doubled spaces', text.replace(/ /g, '  ')],
      ['env prefix', `FOO=1 ${text}`],
      ['sudo prefix', `sudo ${text}`],
      ['wrapped in bash -c', `bash -c "${text.replace(/"/g, '\\"')}"`],
      ['chained after cd', `cd . && ${text}`],
    );
  }
  return out.filter(([, cmd]) => cmd.trim() !== text);
}

// ---- audit and refine --------------------------------------------------------------------------------------

function matcher() {
  return require('./gates-engine').matchGate;
}

function auditGate(gate, options = {}) {
  const command = options.command || learnedCommand(gate);
  const variants = variantsFor(command);
  const match = options.matchGate || matcher();
  // Judge the rule itself, not whether it applies to this project or is active today.
  const probe = { ...gate, scope: 'global', active: true };
  const rows = variants.map(([label, variant]) => {
    let result = { matched: false };
    try { result = match(probe, 'Bash', { command: variant }) || { matched: false }; } catch { result = { matched: false }; }
    const how = !result.matched ? 'missed' : (result.intentOnly ? (intentEnforced() ? 'blocked-by-intent' : 'warned-by-intent') : 'caught');
    return { label, command: variant, result: how };
  });
  const caught = rows.filter((r) => r.result !== 'missed').length;
  return { command, total: rows.length, caught, missed: rows.filter((r) => r.result === 'missed').map((r) => r.label), rows };
}

// Test a newly learned gate against reworded variants; add the intent when some get past. Mutates and returns gate.
function refineGate(gate, options = {}) {
  if (!gate || gate.intent || process.env.THUMBGATE_RULE_MUTATION === '0') return gate;
  const command = learnedCommand(gate);
  if (!command) return gate;
  const before = auditGate(gate, { ...options, command });
  if (!before.total) return gate;
  let after = before;
  if (before.caught < before.total) {
    const intent = intentFor(command);
    if (intent) {
      gate.intent = intent;
      after = auditGate(gate, { ...options, command });
      if (after.caught === before.caught) delete gate.intent;
    }
  }
  gate.mutationAudit = {
    variants: before.total,
    caughtBefore: before.caught,
    caughtAfter: gate.intent ? after.caught : before.caught,
    missed: (gate.intent ? after : before).missed,
    intentMode: gate.intent ? (intentEnforced() ? 'enforce' : 'warn') : null,
    auditedAt: new Date().toISOString(),
  };
  return gate;
}

function formatAudit(audit) {
  const lines = [`Rule test for: ${audit.command}`, ''];
  for (const row of audit.rows) lines.push(`  ${row.result.padEnd(18)} ${row.label.padEnd(30)} ${row.command}`);
  lines.push('', `${audit.caught} of ${audit.total} reworded variants caught.`);
  if (audit.rows.some((r) => r.result === 'warned-by-intent')) {
    lines.push(`Variants caught by intent only warn for now. Set ${INTENT_ENV}=enforce to block them.`);
  }
  return lines.join('\n');
}

function runCli(argv = process.argv.slice(2)) {
  const flag = (name) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    if (hit) return hit.slice(name.length + 3);
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const json = argv.includes('--json');
  const command = flag('command') || argv.filter((a) => !a.startsWith('--')).join(' ');
  if (!command) {
    process.stderr.write('Usage: thumbgate rule-test --command "rm -rf ./build-cache" [--json]\n');
    return 2;
  }
  const pattern = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const plain = { id: 'rule-test', pattern, action: 'block', source: 'force-promote', scope: 'global' };
  const before = auditGate(plain, { command });
  const refined = refineGate({ ...plain });
  const after = refined.intent ? auditGate(refined, { command }) : before;
  if (json) {
    process.stdout.write(`${JSON.stringify({ command, intent: refined.intent || null, before, after }, null, 2)}\n`);
  } else {
    process.stdout.write(`Learned text only:\n${formatAudit(before)}\n\nWith intent${refined.intent ? ` (${refined.intent.kind})` : ' (none found)'}:\n${formatAudit(after)}\n`);
  }
  return 0;
}

module.exports = {
  INTENT_ENV,
  intentEnforced,
  learnedCommand,
  intentFor,
  intentMatches,
  deleteTargetsOf,
  forcePushesOf,
  variantsFor,
  auditGate,
  refineGate,
  formatAudit,
  runCli,
};

if (require.main === module) process.exitCode = runCli();
