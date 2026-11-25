'use strict';

// A `git commit` writes whatever is staged into history for good. The tool-input secret guard only sees the commit
// command text, never the staged files, so a key sitting in a staged file went through (measured 25 Nov 2026,
// tests/commit-secret-and-rm-gates.test.js). This reads the lines the commit would ADD and runs the secret scanner's
// high-confidence provider patterns over them.
//
// Decision: deny, not warn. A key committed once is in every clone and needs rotating, a blocked commit costs one retry
// after unstaging the key, and the secret guard already denies the same key in any other tool input.
// Left out on purpose: the generic `password = ...` assignment pattern (too many false positives in diffs), lines that
// are removed, and anything but literal `git commit`. `but commit` (GitButler) and commits made by a script are not seen.

const { spawnSync } = require('node:child_process');
const { SECRET_PATTERNS } = require('./secret-scanner');

const COMMIT_RE = /(?:^|[;&|(]\s*|&&\s*)git(?:\s+-[cC]\s+\S+)*\s+commit\b([^;&|\n]*)/g;

function commitInvocations(command) {
  const out = [];
  const text = String(command || '');
  COMMIT_RE.lastIndex = 0;
  let m;
  while ((m = COMMIT_RE.exec(text))) out.push(m[1] || '');
  return out;
}

function diffArgsFor(flags) {
  if (/(?:^|\s)--dry-run\b|(?:^|\s)--help\b/.test(flags)) return null;
  // -a / --all (also inside -am) stages tracked changes at commit time, so look at the working tree against HEAD.
  const all = /(?:^|\s)--all\b/.test(flags) || /(?:^|\s)-[A-Za-z]*a[A-Za-z]*(?=\s|$)/.test(flags);
  return all ? ['diff', 'HEAD', '-U0', '--no-color'] : ['diff', '--cached', '-U0', '--no-color'];
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
  const invocations = commitInvocations(command);
  if (!invocations.length) return null;

  const findings = [];
  const seen = new Set();
  for (const flags of invocations) {
    const args = diffArgsFor(flags);
    if (!args) continue;
    const res = spawnSync('git', args, { cwd: cwd || process.cwd(), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 10000 });
    if (res.status !== 0 || !res.stdout) continue; // not a repo, or nothing staged: never block on a git error
    for (const { file, text } of addedLines(res.stdout)) {
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

module.exports = { scanStagedForCommit, commitInvocations, diffArgsFor, addedLines };
