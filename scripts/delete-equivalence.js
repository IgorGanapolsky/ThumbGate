'use strict';

// A learned rule remembers one delete command as literal text, so the same delete written another way slipped past it.
// This reads the target out of a learned rm/rmdir/unlink command, and out of a Python delete call, and says whether
// they name the same path. It is deliberately narrow, and the test in tests/learned-delete-reworded.test.js lists what
// it covers:
//   - Python calls with a literal path: shutil.rmtree, os.remove, os.unlink, os.rmdir, os.removedirs,
//     Path('...').unlink / .rmdir, and subprocess/os.system calls that run rm on a literal path.
//   - Found in a `python -c` command, a heredoc script, or the content of a Write/Edit to a .py file.
// Not covered: a path built at run time (concatenation, os.path.join, variables, environment), a script the gate cannot
// see, a parent directory of the learned path, and other languages.

const os = require('node:os');
const path = require('node:path');

const RM_COMMANDS = new Set(['rm', 'rmdir', 'unlink']);
// A literal path counts only when it is the whole argument: `'x' + '-backup'` is a different, computed path.
const PY_PATH_CALL = /\b(?:shutil\s*\.\s*rmtree|os\s*\.\s*(?:remove|unlink|rmdir|removedirs))\s*\(\s*(?:[rbuf]{0,2})(['"])((?:(?!\1)[^\\\n]|\\.)*)\1(?=\s*[,)])/gi;
const PY_PATHLIB_CALL = /\bPath\s*\(\s*(?:[rbuf]{0,2})(['"])((?:(?!\1)[^\\\n]|\\.)*)\1\s*\)\s*\.\s*(?:unlink|rmdir)\s*\(/gi;
// An rm argument list counts only when it is passed to a call that runs it, not when it is printed or stored.
const PY_RM_LIST = /\b(?:subprocess\s*\.\s*(?:run|call|check_call|check_output|Popen)|os\s*\.\s*(?:execvp?|spawnvp?))\s*\(\s*(?:[^,()]*,\s*)?\[\s*(['"])(?:\/\S*\/)?rm\1\s*((?:,\s*(['"])(?:(?!\3)[^\\\n]|\\.)*\3\s*)*)\]/gi;
const PY_RM_STRING = /\b(?:os\s*\.\s*system|subprocess\s*\.\s*(?:run|call|check_call|check_output|Popen))\s*\(\s*(?:[rbuf]{0,2})(['"])((?:(?!\1)[^\\\n]|\\.)*)\1(?=\s*[,)])/gi;

function normalizePath(raw) {
  let value = String(raw || '').trim().replace(/^['"]|['"]$/g, '');
  if (!value) return '';
  if (value === '~' || value.startsWith('~/')) value = path.join(os.homedir(), value.slice(1));
  value = value.replace(/\/{2,}/g, '/');
  value = path.posix.normalize(value);
  if (value.length > 1) value = value.replace(/\/+$/, '');
  return value;
}

function shellWords(text) {
  const words = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(text))) words.push(m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]));
  return words;
}

// Targets of an rm / rmdir / unlink command written as shell text. Flags and `--` are skipped.
function shellDeleteTargets(command) {
  const targets = [];
  for (const segment of String(command || '').split(/[;&|\n]+/)) {
    const words = shellWords(segment.trim());
    while (words.length && (words[0] === 'sudo' || words[0] === 'command' || /^\w+=/.test(words[0]))) words.shift();
    if (!words.length || !RM_COMMANDS.has(path.posix.basename(words[0]))) continue;
    let endOfFlags = false;
    for (const word of words.slice(1)) {
      if (!endOfFlags && word === '--') { endOfFlags = true; continue; }
      if (!endOfFlags && word.startsWith('-')) continue;
      const target = normalizePath(word);
      if (target) targets.push(target);
    }
  }
  return targets;
}

function pythonDeleteTargets(text) {
  const source = String(text || '');
  const targets = [];
  const take = (re, group) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source))) {
      const target = normalizePath(m[group]);
      if (target) targets.push(target);
    }
  };
  take(PY_PATH_CALL, 2);
  take(PY_PATHLIB_CALL, 2);
  PY_RM_LIST.lastIndex = 0;
  let list;
  while ((list = PY_RM_LIST.exec(source))) {
    const args = [...list[2].matchAll(/(['"])((?:(?!\1)[^\\\n]|\\.)*)\1/g)].map((a) => a[2]).filter((a) => !a.startsWith('-'));
    for (const arg of args) {
      const target = normalizePath(arg);
      if (target) targets.push(target);
    }
  }
  PY_RM_STRING.lastIndex = 0;
  let call;
  while ((call = PY_RM_STRING.exec(source))) targets.push(...shellDeleteTargets(call[2]));
  return targets;
}

// The learned gate stores the command as an escaped regex (see contextToPattern in auto-promote-gates.js).
function learnedDeleteTargets(gate) {
  if (!gate || typeof gate.pattern !== 'string') return [];
  const learned = gate.source === 'force-promote' || gate.source === 'auto-promote' || /^auto:/.test(String(gate.trigger || ''));
  if (!learned) return [];
  return shellDeleteTargets(gate.pattern.replace(/\\(.)/g, '$1'));
}

function looksLikePython(toolName, toolInput) {
  const command = String((toolInput && toolInput.command) || '');
  if (/\bpython[\d.]*\b/i.test(command)) return true;
  const file = String((toolInput && (toolInput.file_path || toolInput.path)) || '');
  return /\.py$/i.test(file);
}

function textToScan(toolName, toolInput) {
  if (!toolInput) return '';
  if (toolInput.command) {
    // Inside shell double quotes, \" \\ \$ and \` reach Python without the backslash, so scan that form too.
    const command = String(toolInput.command);
    const unescaped = command.replace(/\\(["\\$`])/g, '$1');
    return unescaped === command ? command : `${command}\n${unescaped}`;
  }
  return String(toolInput.content || toolInput.new_string || toolInput.new_str || '');
}

// True when this tool call deletes, through Python, a path the learned delete command already named.
function isReworkedLearnedDelete(gate, toolName, toolInput) {
  if (!looksLikePython(toolName, toolInput)) return false;
  const learned = learnedDeleteTargets(gate);
  if (!learned.length) return false;
  const attempted = new Set(pythonDeleteTargets(textToScan(toolName, toolInput)));
  return learned.some((target) => attempted.has(target));
}

module.exports = { isReworkedLearnedDelete, learnedDeleteTargets, pythonDeleteTargets, shellDeleteTargets, normalizePath };
