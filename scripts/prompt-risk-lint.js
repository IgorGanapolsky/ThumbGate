'use strict';

// AGENT-3667 item J3: prompt-risk lint. Warns, never blocks, when CLAUDE.md or AGENTS.md uses wording that
// Anthropic's Safeguards team found associated with more "reaching outside" in its sandbox tests.
// Source: "Measuring and mitigating agent sandbox escape with Siren", 24 Nov 2026,
// https://safeguards.anthropic.com/2026/siren/ . The post reports that removing such wording cut reaching outside in
// most of the models it tested. This lint says "associated with", not "causes".
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = 'https://safeguards.anthropic.com/2026/siren/';
const RISKY = [
  /search\s+(?:thoroughly|exhaustively)/i,
  /(?:full|unrestricted|unlimited|root)\s+access\s+to\s+(?:this|the|your)\s+(?:machine|computer|system|laptop)/i,
  /broad\s+authority\s+over\s+(?:this|the|your|its)\s+(?:own\s+)?(?:machine|computer|system)/i,
  /do\s+whatever\s+it\s+takes/i,
];
const DEFAULT_FILES = ['CLAUDE.md', 'AGENTS.md'];

function lintText(text, file = 'prompt') {
  const findings = [];
  String(text || '').split('\n').forEach((line, i) => {
    for (const re of RISKY) {
      const m = line.match(re);
      if (m) findings.push({ file, line: i + 1, phrase: m[0], source: SOURCE });
    }
  });
  return findings;
}

function lintFiles(files, cwd = process.cwd()) {
  const findings = [];
  for (const f of files && files.length ? files : DEFAULT_FILES) {
    const full = path.resolve(cwd, f);
    let text;
    try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
    findings.push(...lintText(text, f));
  }
  return findings;
}

function formatFindings(findings) {
  if (!findings.length) return 'prompt-lint: no wording from the Anthropic sandbox-escape study found. Nothing to change.';
  const lines = findings.map((f) => `warning: ${f.file}:${f.line}: "${f.phrase}"`);
  lines.push('', `Why: in Anthropic's sandbox-escape tests (${SOURCE}, 24 Nov 2026), wording like this was associated with more reaching outside the task's environment, and removing it reduced reaching outside in most models tested. That study does not show these words cause it, and it makes no claim about ThumbGate. This is a warning only; nothing is blocked.`);
  return lines.join('\n');
}

module.exports = { lintText, lintFiles, formatFindings, SOURCE };
