'use strict';

// AGENT-3667: Cline, OpenCode and Amp. What does `thumbgate init` actually give each of them?
// Captured run (below): init writes an MCP server entry, and for Cline a rules file. It writes no hook that runs
// before a tool call, so nothing on the host side can stop a command if the model does not call gate_check.
// So these three hosts are "advisory" (Cline, OpenCode) or "feedback capture" (Amp) and no page may say
// that ThumbGate blocks, intercepts or refuses their calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');

function initFor(agent) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `tg-adv-${agent}-`)));
  const project = path.join(home, 'proj');
  fs.mkdirSync(project);
  cp.execFileSync('git', ['init', '-q'], { cwd: project });
  const env = { ...process.env, HOME: home, THUMBGATE_NO_TELEMETRY: '1', THUMBGATE_NO_RATE_LIMIT: '1' };
  const r = cp.spawnSync(process.execPath, [CLI, 'init', '--agent', agent], { cwd: project, env, encoding: 'utf8', timeout: 90000 });
  return { home, project, status: r.status, done: () => fs.rmSync(home, { recursive: true, force: true }) };
}

function read(file) { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null; }

const INTERCEPT_TOKENS = /PreToolUse|beforeShellExecution|tool\.execute\.before|"hooks"|"plugin"|permission\.ask/;

const HOSTS = [
  { agent: 'cline', files: (w) => [path.join(w.project, '.clinerules'), path.join(w.project, '.mcp.json')], expectFile: (w) => path.join(w.project, '.clinerules') },
  { agent: 'opencode', files: (w) => [path.join(w.home, '.config', 'opencode', 'opencode.json')], expectFile: (w) => path.join(w.home, '.config', 'opencode', 'opencode.json') },
  { agent: 'amp', files: (w) => [path.join(w.project, '.mcp.json')], expectFile: (w) => path.join(w.project, '.mcp.json') },
];

for (const host of HOSTS) {
  test(`captured run: thumbgate init --agent ${host.agent} writes no hook that runs before a tool call`, () => {
    const w = initFor(host.agent);
    try {
      assert.equal(w.status, 0, 'init exits 0');
      assert.ok(fs.existsSync(host.expectFile(w)), `init wrote ${path.relative(w.home, host.expectFile(w))}`);
      for (const file of host.files(w)) {
        const text = read(file);
        if (text === null) continue;
        assert.doesNotMatch(text, INTERCEPT_TOKENS, `${path.relative(w.home, file)} must not claim a pre-tool-call hook`);
      }
    } finally { w.done(); }
  });
}

// ---- no page may say ThumbGate stops calls on these hosts ----
const HOST_RE = /\b(cline|opencode|amp)\b/i;
const CLAIM_RE = /hard[- ]?block|intercepts? tool calls|block(?:s|ed)? (?:the )?(?:next )?[^.]{0,60}before the tool call runs|refuses the call|before they fire|enforce outside|ships as a pre-action gate for every/i;
const OK_RE = /advisory|feedback only|feedback capture|warns? only|may ignore|if the (?:agent|model)|cannot stop|does not stop|not enforce/i;

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.clinerules') continue;
    if (['node_modules', 'plans', 'reviews'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => entry.name.endsWith(e)) || entry.name === '.clinerules') out.push(full);
  }
  return out;
}

function sentences(file) {
  let text = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.html')) text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&mdash;/g, '-');
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

test('no page or doc says ThumbGate blocks, intercepts or refuses calls on Cline, OpenCode or Amp', () => {
  const files = [
    path.join(ROOT, 'README.md'),
    ...walk(path.join(ROOT, 'public'), ['.html']),
    ...walk(path.join(ROOT, 'docs'), ['.md']),
    ...walk(path.join(ROOT, 'adapters'), ['.md']),
  ];
  const offenders = [];
  for (const file of files) {
    for (const s of sentences(file)) {
      if (HOST_RE.test(s) && CLAIM_RE.test(s) && !OK_RE.test(s)) offenders.push(`${path.relative(ROOT, file)}: ${s.slice(0, 160)}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('every home-page table row naming Cline, OpenCode or Amp labels it advisory or feedback only', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const rows = html.match(/<tr><th>[^<]*(?:Cline|OpenCode|Amp)[^<]*<\/th>[\s\S]*?<\/tr>/g) || [];
  assert.ok(rows.length >= 2, 'rows for these hosts exist');
  for (const row of rows) assert.match(row, /Advisory|Feedback only/, row.slice(0, 120));
  const enforcement = rows.find((r) => /Cursor other, Cline, OpenCode/.test(r));
  assert.ok(enforcement && /model has to call/i.test(enforcement), 'enforcement table says the agent must call gate_check itself');
});

test('the Cline rules file calls itself advisory, not enforcement', () => {
  const rules = fs.readFileSync(path.join(ROOT, 'adapters', 'cline', '.clinerules'), 'utf8');
  assert.doesNotMatch(rules.split('\n')[0], /enforcement/i);
  assert.match(rules, /advisory/i);
});
