'use strict';

// A `git commit` writes whatever is staged into history for good. The tool-input secret guard only sees the commit
// command text, never the staged files, so a key sitting in a staged file went through (measured 25 Nov 2026,
// tests/commit-secret-and-rm-gates.test.js). This reads the lines the commit would ADD and runs the secret scanner's
// high-confidence provider patterns over them.
//
// Decision: deny, not warn. A key committed once is in every clone and needs rotating, a blocked commit costs one retry
// after unstaging the key, and the secret guard already denies the same key in any other tool input.
// Left out on purpose: the generic `password = ...` assignment pattern (too many false positives in diffs), lines that
// are removed, and anything but literal `git commit` (with `-C <dir>` or a preceding `cd <dir>` honoured). `but commit` (GitButler) and commits made by a script are not seen.

const { spawnSync } = require('node:child_process');
const { SECRET_PATTERNS } = require('./secret-scanner');

const path = require('node:path');

// Global options before `commit` are captured so `git -C <dir> commit` scans <dir>, not the hook's cwd.
const COMMIT_RE = /(?:^|[;&|(]\s*|&&\s*)git((?:\s+-[cC]\s+(?:"[^"]*"|'[^']*'|\S+))*)\s+commit\b([^;&|\n]*)/g;
const CD_RE = /(?:^|[;&|(]\s*|&&\s*)cd\s+("[^"]*"|'[^']*'|[^\s;&|]+)/g;

function unquote(token) {
  const t = String(token || '');
  return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")) ? t.slice(1, -1) : t;
}

// Shell-like split that keeps quoted strings whole ("-m 'a b'" -> ['-m', 'a b']).
function tokenize(text) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(text || '')))) out.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
  return out;
}

function resolveDir(base, dir) {
  if (!dir) return base;
  if (dir === '~' || dir.startsWith('~/')) return path.join(require('node:os').homedir(), dir.slice(2));
  return path.resolve(base, dir);
}

function commitInvocations(command, cwd) {
  const out = [];
  const text = String(command || '');
  const base = cwd || process.cwd();
  COMMIT_RE.lastIndex = 0;
  let m;
  while ((m = COMMIT_RE.exec(text))) {
    // `cd <dir> && git commit`: apply every cd that runs before this commit in the same command line.
    let dir = base;
    CD_RE.lastIndex = 0;
    let c;
    while ((c = CD_RE.exec(text)) && c.index < m.index) dir = resolveDir(dir, unquote(c[1]));
    const globals = tokenize(m[1] || '');
    for (let i = 0; i < globals.length; i += 1) {
      if (globals[i] === '-C' && i + 1 < globals.length) { dir = resolveDir(dir, globals[i + 1]); i += 1; }
      else if (globals[i] === '-c') i += 1;
    }
    out.push({ flags: m[2] || '', dir });
  }
  return out;
}

// Commit options whose value is the next token (when not attached, e.g. -m"msg" or --file=x).
const SHORT_WITH_VALUE = new Set(['m', 'F', 'C', 'c', 't']);
const LONG_WITH_VALUE = new Set(['--message', '--file', '--reuse-message', '--reedit-message', '--author', '--date',
  '--cleanup', '--fixup', '--squash', '--template', '--trailer', '--pathspec-from-file']);

function parseCommitFlags(flags) {
  const tokens = tokenize(flags);
  const opts = { all: false, include: false, dryRun: false, pathspecs: [] };
  let afterDashDash = false;
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (afterDashDash) { opts.pathspecs.push(t); continue; }
    if (t === '--') { afterDashDash = true; continue; }
    if (t.startsWith('--')) {
      const name = t.split('=')[0];
      if (name === '--all') opts.all = true;
      else if (name === '--include') opts.include = true;
      else if (name === '--dry-run' || name === '--help') opts.dryRun = true;
      if (LONG_WITH_VALUE.has(name) && !t.includes('=')) i += 1;
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

// The diffs whose added lines the commit would write. Working tree vs HEAD is read as index-vs-HEAD plus
// worktree-vs-index, so it also works before the first commit (no HEAD yet).
function diffArgsFor(flags) {
  const opts = parseCommitFlags(flags);
  if (opts.dryRun) return null;
  const base = ['diff', '-U0', '--no-color'];
  const cached = ['diff', '--cached', '-U0', '--no-color'];
  if (opts.pathspecs.length) {
    const paths = ['--', ...opts.pathspecs];
    // --only (the default with paths): exactly those paths, as they are in the working tree.
    // --include: the whole index plus those paths' working-tree content.
    return opts.include
      ? [cached, [...base, ...paths]]
      : [[...cached, ...paths], [...base, ...paths]];
  }
  // -a / --all stages tracked changes at commit time.
  return opts.all ? [cached, base] : [cached];
}

function addedLines(diffText) {
  const lines = [];
  let file = '';
  for (const line of String(diffText).split('\n')) {
    if (line.startsWith('+++ ')) { file = line.slice(4).replace(/^b\//, ''); continue; }
    if (line.startsWith('+') && !line.startsWith('+++')) lines.push({ file, text: line.slice(1) });
  }
  return lines;
}

// Returns a scan result in the shape the secret guard already handles, or null.
function scanStagedForCommit(toolName, toolInput, cwd) {
  if (String(toolName || '').toLowerCase() !== 'bash') return null;
  const command = toolInput && (toolInput.command || toolInput.cmd);
  if (typeof command !== 'string' || !/\bgit\b[^\n]*\bcommit\b/.test(command)) return null;
  const invocations = commitInvocations(command, cwd);
  if (!invocations.length) return null;

  const findings = [];
  const seen = new Set();
  const lines = [];
  for (const { flags, dir } of invocations) {
    const diffs = diffArgsFor(flags);
    if (!diffs) continue;
    for (const args of diffs) {
      const res = spawnSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 10000 });
      if (res.status !== 0 || !res.stdout) continue; // not a repo, or nothing staged: never block on a git error
      lines.push(...addedLines(res.stdout));
    }
  }
  {
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
  }
  if (!findings.length) return null;
  return { detected: true, provider: 'staged-commit', toolName: 'Bash', findings, commandHash: null, fileHashes: [] };
}

module.exports = { scanStagedForCommit, commitInvocations, diffArgsFor, parseCommitFlags, addedLines };
