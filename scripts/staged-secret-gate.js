'use strict';

// A `git commit` writes whatever is staged into history for good. The tool-input secret guard only sees the commit
// command text, never the staged files, so a key sitting in a staged file went through (measured 25 Nov 2026,
// tests/commit-secret-and-rm-gates.test.js). This reads the lines the commit would ADD and runs the secret scanner's
// high-confidence provider patterns over them.
//
// Decision: deny, not warn. A key committed once is in every clone and needs rotating, a blocked commit costs one retry
// after unstaging the key, and the secret guard already denies the same key in any other tool input.
// What is read, per commit mode:
//   plain commit          -> the index against HEAD
//   -a / --all            -> the working tree of tracked files against HEAD
//   <paths> (--only)      -> those paths' working tree against HEAD
//   -i <paths>            -> the index (other paths) plus those paths' working tree against HEAD
//   `git add X && git commit` in one command -> also X as it is on disk, since it is staged only after this check runs
// `git -C <dir>` and a preceding `cd <dir>` choose the repository; a `cd` inside a subshell that has closed does not.
// A scan git could not finish (too large, timed out) is reported as incomplete instead of passing silently.
// Left out on purpose: the generic `password = ...` assignment pattern (too many false positives in diffs), removed
// lines, `but commit` (GitButler) and commits made by a script.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { SECRET_PATTERNS } = require('./secret-scanner');

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const DIFF_FLAGS = ['-U0', '--no-color', '--text', '--no-ext-diff', '--no-textconv'];
const MAX_BUFFER = 16 * 1024 * 1024;
const MAX_UNTRACKED_FILES = 500;

// A shell command boundary: start, newline, ; & | ( or { — with any leading whitespace.
const BOUNDARY = String.raw`(?:^|[\n;&|({])\s*`;
const COMMIT_RE = new RegExp(`${BOUNDARY}git((?:\\s+-[cC]\\s+(?:"[^"]*"|'[^']*'|\\S+))*)\\s+commit\\b([^;&|\\n)]*)`, 'g');
const STAGE_RE = new RegExp(`${BOUNDARY}git((?:\\s+-[cC]\\s+(?:"[^"]*"|'[^']*'|\\S+))*)\\s+(?:add|stage)\\b([^;&|\\n)]*)`, 'g');
const CD_RE = new RegExp(`${BOUNDARY}cd\\s+("[^"]*"|'[^']*'|[^\\s;&|)]+)`, 'g');

// Shell word splitting: quotes may sit inside a word (-m"fix config" is one argument), backslash escapes outside '...'.
function tokenize(text) {
  const out = [];
  const s = String(text || '');
  let cur = '';
  let inWord = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (/\s/.test(ch)) { if (inWord) { out.push(cur); cur = ''; inWord = false; } continue; }
    inWord = true;
    if (ch === "'") {
      const end = s.indexOf("'", i + 1);
      cur += end === -1 ? s.slice(i + 1) : s.slice(i + 1, end);
      i = end === -1 ? s.length : end;
    } else if (ch === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') { if (s[j] === '\\' && j + 1 < s.length) j += 1; cur += s[j]; j += 1; }
      i = j;
    } else if (ch === '\\' && i + 1 < s.length) {
      cur += s[i + 1]; i += 1;
    } else {
      cur += ch;
    }
  }
  if (inWord) out.push(cur);
  return out;
}

function resolveDir(base, dir) {
  if (!dir) return base;
  if (dir === '~' || dir.startsWith('~/')) return path.join(os.homedir(), dir.slice(2));
  return path.resolve(base, dir);
}

// True when the text between `from` and `to` closes a subshell/group that was open at `from`.
function leavesScope(text, from, to) {
  let depth = 0;
  for (let i = from; i < to; i += 1) {
    if (text[i] === '(' || text[i] === '{') depth += 1;
    else if (text[i] === ')' || text[i] === '}') { depth -= 1; if (depth < 0) return true; }
  }
  return false;
}

function dirAt(text, index, base) {
  let dir = base;
  CD_RE.lastIndex = 0;
  let c;
  while ((c = CD_RE.exec(text)) && c.index < index) {
    if (leavesScope(text, c.index + c[0].length, index)) continue; // `(cd x && ...); git commit` stays in base
    dir = resolveDir(dir, tokenize(c[1])[0] || '');
  }
  return dir;
}

function applyGlobals(dir, globalText) {
  const globals = tokenize(globalText || '');
  let out = dir;
  for (let i = 0; i < globals.length; i += 1) {
    if (globals[i] === '-C' && i + 1 < globals.length) { out = resolveDir(out, globals[i + 1]); i += 1; } else if (globals[i] === '-c') i += 1;
  }
  return out;
}

function commitInvocations(command, cwd) {
  const out = [];
  const text = String(command || '');
  const base = cwd || process.cwd();
  COMMIT_RE.lastIndex = 0;
  let m;
  while ((m = COMMIT_RE.exec(text))) {
    const dir = applyGlobals(dirAt(text, m.index, base), m[1]);
    // `git add X && git commit`: X is staged only after this check runs, so read X from disk too.
    const staged = [];
    STAGE_RE.lastIndex = 0;
    let a;
    while ((a = STAGE_RE.exec(text)) && a.index < m.index) {
      if (leavesScope(text, a.index + a[0].length, m.index)) continue;
      const addDir = applyGlobals(dirAt(text, a.index, base), a[1]);
      if (addDir === dir) staged.push(...tokenize(a[2]));
    }
    out.push({ flags: m[2] || '', dir, staged });
  }
  return out;
}

// Commit options whose value is the next token (when not attached, e.g. -m"msg" or --file=x).
const SHORT_WITH_VALUE = new Set(['m', 'F', 'C', 'c', 't']);
const LONG_WITH_VALUE = new Set(['--message', '--file', '--reuse-message', '--reedit-message', '--author', '--date',
  '--cleanup', '--fixup', '--squash', '--template', '--trailer', '--pathspec-from-file']);

function parseCommitFlags(flags) {
  const tokens = tokenize(flags);
  const opts = { all: false, include: false, dryRun: false, pathspecs: [], pathspecFromFile: null, pathspecNul: false };
  let afterDashDash = false;
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (afterDashDash) { opts.pathspecs.push(t); continue; }
    if (t === '--') { afterDashDash = true; continue; }
    if (t.startsWith('--')) {
      const eq = t.indexOf('=');
      const name = eq === -1 ? t : t.slice(0, eq);
      if (name === '--all') opts.all = true;
      else if (name === '--include') opts.include = true;
      else if (name === '--dry-run' || name === '--help') opts.dryRun = true;
      else if (name === '--pathspec-file-nul') opts.pathspecNul = true;
      if (LONG_WITH_VALUE.has(name)) {
        const value = eq === -1 ? tokens[i + 1] : t.slice(eq + 1);
        if (name === '--pathspec-from-file') opts.pathspecFromFile = value == null ? '' : value;
        if (eq === -1) i += 1;
      }
      continue;
    }
    if (t.startsWith('-') && t.length > 1) {
      const cluster = t.slice(1);
      for (let j = 0; j < cluster.length; j += 1) {
        const ch = cluster[j];
        if (ch === 'a') opts.all = true;
        else if (ch === 'i') opts.include = true;
        else if (ch === 'h') opts.dryRun = true;
        if (SHORT_WITH_VALUE.has(ch)) { if (j === cluster.length - 1) i += 1; break; } // rest of cluster is the value
      }
      continue;
    }
    opts.pathspecs.push(t);
  }
  return opts;
}

function git(args, dir) {
  const res = spawnSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: MAX_BUFFER, timeout: 10000 });
  if (res.error || res.signal) return { ok: false, incomplete: true, out: '' }; // too large, timed out, killed
  if (res.status !== 0) return { ok: false, incomplete: false, out: '' }; // not a repo, bad pathspec: never block
  return { ok: true, incomplete: false, out: res.stdout || '' };
}

function baseTree(dir) {
  return git(['rev-parse', '--verify', '-q', 'HEAD'], dir).ok ? 'HEAD' : EMPTY_TREE;
}

function readPathspecFile(dir, opts) {
  const file = opts.pathspecFromFile;
  if (!file || file === '-') return null; // stdin: cannot be read here
  try {
    const raw = fs.readFileSync(path.resolve(dir, file), 'utf8');
    return raw.split(opts.pathspecNul ? '\0' : /\r?\n/).map((p) => p.trim()).filter(Boolean);
  } catch { return null; }
}

// The `git diff` calls whose added lines this commit would write. Null for a dry run.
function diffArgsFor(flags, dir = process.cwd()) {
  const opts = parseCommitFlags(flags);
  if (opts.dryRun) return null;
  const head = baseTree(dir);
  let paths = opts.pathspecs.slice();
  if (opts.pathspecFromFile !== null) {
    const fromFile = readPathspecFile(dir, opts);
    // Unreadable (or stdin): read every tracked change in the working tree rather than guess the index alone.
    if (!fromFile) return [['diff', head, ...DIFF_FLAGS]];
    paths.push(...fromFile);
  }
  if (paths.length) {
    const worktree = ['diff', head, ...DIFF_FLAGS, '--', ...paths];
    if (!opts.include) return [worktree];
    return [['diff', '--cached', ...DIFF_FLAGS, '--', '.', ...paths.map((p) => `:(exclude)${p}`)], worktree];
  }
  if (opts.all) return [['diff', head, ...DIFF_FLAGS]];
  return [['diff', '--cached', ...DIFF_FLAGS]];
}

// Added lines of a unified diff. `+++ ` is a file header only between hunks: inside a hunk `+++counter;` is the
// added line `++counter;`.
function addedLines(diffText) {
  const lines = [];
  let file = '';
  let inHunk = false;
  for (const line of String(diffText).split('\n')) {
    if (line.startsWith('diff --git ')) { inHunk = false; continue; }
    if (!inHunk && line.startsWith('+++ ')) { file = line.slice(4).replace(/^b\//, ''); continue; }
    if (!inHunk && line.startsWith('--- ')) continue;
    if (line.startsWith('@@')) { inHunk = true; continue; }
    if (inHunk && line.startsWith('+')) lines.push({ file, text: line.slice(1) });
  }
  return lines;
}

// Lines of files a same-command `git add` will stage, read from disk. Directories and `.`/-A/-u read the whole
// working tree (tracked changes plus untracked files).
function stagedByCommandLines(dir, args) {
  const lines = [];
  let incomplete = false;
  const files = new Set();
  let wholeTree = false;
  let afterDashDash = false;
  for (const a of args) {
    if (!afterDashDash && a === '--') { afterDashDash = true; continue; }
    if (!afterDashDash && a.startsWith('-')) { if (/^-(?:A|u|-all|-update)$/.test(a) || /^-[a-zA-Z]*[Au]/.test(a)) wholeTree = true; continue; }
    const abs = path.resolve(dir, a);
    let stat = null;
    try { stat = fs.statSync(abs); } catch { /* pattern or missing */ }
    if (stat && stat.isFile()) files.add(abs);
    else wholeTree = true; // a directory, `.`, or a glob
  }
  if (wholeTree) {
    const tracked = git(['diff', baseTree(dir), ...DIFF_FLAGS], dir);
    if (tracked.incomplete) incomplete = true;
    lines.push(...addedLines(tracked.out));
    const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'], dir);
    if (untracked.incomplete) incomplete = true;
    const names = untracked.out.split('\0').filter(Boolean);
    if (names.length > MAX_UNTRACKED_FILES) incomplete = true;
    for (const n of names.slice(0, MAX_UNTRACKED_FILES)) files.add(path.resolve(dir, n));
  }
  for (const abs of files) {
    try {
      const st = fs.statSync(abs);
      if (st.size > MAX_BUFFER) { incomplete = true; continue; }
      const rel = path.relative(dir, abs);
      for (const text of fs.readFileSync(abs, 'utf8').split('\n')) lines.push({ file: rel, text });
    } catch { /* unreadable: git add would fail on it too */ }
  }
  return { lines, incomplete };
}

function matchLines(lines) {
  const findings = [];
  const seen = new Set();
  for (const { file, text } of lines) {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.id === 'generic_assignment' || pattern.id === 'pem_private_key') continue;
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(text)) {
        const key = `${pattern.id}:${file}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({ id: pattern.id, label: pattern.label, source: 'staged-commit', path: file, reason: `${pattern.label} staged in ${file}` });
      }
    }
    if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/.test(text)) {
      const key = `pem_private_key:${file}`;
      if (!seen.has(key)) { seen.add(key); findings.push({ id: 'pem_private_key', label: 'Private key block', source: 'staged-commit', path: file, reason: `Private key block staged in ${file}` }); }
    }
  }
  return findings;
}

// Returns a scan result in the shape the secret guard already handles, or null.
function scanStagedForCommit(toolName, toolInput, cwd) {
  if (String(toolName || '').toLowerCase() !== 'bash') return null;
  const command = toolInput && (toolInput.command || toolInput.cmd);
  if (typeof command !== 'string' || !/\bgit\b[\s\S]*\bcommit\b/.test(command)) return null;
  const invocations = commitInvocations(command, cwd);
  if (!invocations.length) return null;

  const lines = [];
  let incomplete = false;
  // A lone commit into a folder that does not exist fails by itself; a chained command could create it first.
  const lone = !/[;&|\n`]|\$\(/.test(command);
  for (const { flags, dir, staged } of invocations) {
    // A `-C $VAR` operand is expanded by the shell, so a literal-missing path proves nothing: keep scanning it.
    if (lone && dir && !dir.includes('$') && !fs.existsSync(dir)) continue;
    const diffs = diffArgsFor(flags, dir);
    if (!diffs) continue;
    for (const args of diffs) {
      const res = git(args, dir);
      if (res.incomplete) incomplete = true;
      lines.push(...addedLines(res.out));
    }
    if (staged.length) {
      const extra = stagedByCommandLines(dir, staged);
      if (extra.incomplete) incomplete = true;
      lines.push(...extra.lines);
    }
  }
  const findings = matchLines(lines);
  if (incomplete) {
    findings.push({ id: 'staged_scan_incomplete', label: 'Commit scan incomplete', source: 'staged-commit', path: null,
      reason: 'the commit is too large or slow to scan for secrets; commit it in smaller parts' });
  }
  if (!findings.length) return null;
  return { detected: true, provider: 'staged-commit', toolName: 'Bash', findings, commandHash: null, fileHashes: [] };
}

module.exports = { scanStagedForCommit, commitInvocations, diffArgsFor, parseCommitFlags, addedLines, tokenize };
