#!/usr/bin/env node
'use strict';

/**
 * Monthly original-data report: what AI coding agents tried to do this month.
 *
 * Reads ThumbGate's own local logs (gate-events-log.jsonl, audit-trail.jsonl,
 * agent-registry.jsonl under ~/.thumbgate) for ONE operator's fleet, keeps
 * only aggregate counts (no commands, paths, messages, project names), and
 * writes public/reports/<month>.data.json plus public/reports/<month>.html.
 * Every number on the page comes from the JSON this script writes; the test
 * tests/monthly-report.test.js checks that the page and the JSON agree.
 *
 *   node scripts/build-monthly-report.js --month 2026-11 --through 2026-11-17
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// gateId -> plain-language action type. Unmapped gates fall under "Other gate".
const ACTION_TYPES = {
  'force-push': 'Force-push',
  'secret-exfiltration': 'Secret material in a tool call',
  'deny-network-egress': 'Unauthorized network egress',
  'memory-high-risk-default-deny': 'Repeat of a high-risk action ThumbGate had already been told was bad',
  'task-scope-edit-boundary': 'Edit outside the declared task scope',
  'supply-chain-dep-add': 'Dependency added to package.json',
  'gh-pr-create-restricted': 'Pull request opened without permission evidence',
  'pr-thread-resolution-verified-required': 'Commit on a PR branch before review threads were verified',
  'workflow-sentinel': 'High predicted workflow risk before execution',
};

// ThumbGate's own MCP tools. Everything else evaluated by the gate engine
// (Bash, Edit, Write, Read, ...) is an "agent action".
const THUMBGATE_TOOLS = new Set([
  'capture_feedback', 'recall', 'gate_check', 'record_task_outcome', 'satisfy_gate',
  'verify_claim', 'retrieve_lessons', 'search_lessons', 'set_task_scope', 'track_action',
  'reconcile_purchase_ledger', 'get_agent_outcome_metrics', 'prevention_rules',
]);

// Command patterns counted in shell tool calls. Only counts are published,
// never the commands. "Contains" means the pattern appears in the command text.
const COMMAND_PATTERNS = [
  { id: 'rm-rf', label: 'rm -rf (recursive force delete)', re: /\brm\s+(?:-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\b/ },
  { id: 'git-force-push', label: 'git push --force', re: /\bgit\s+push\b[^|;&\n]*(?:--force\b|--force-with-lease|\s-f\b)/ },
  { id: 'git-reset-hard', label: 'git reset --hard', re: /\bgit\s+reset\s+--hard\b/ },
  { id: 'secret-read', label: 'Reading a secrets file or keychain entry', re: /\b(?:cat|less|head|tail|grep|sed|awk|source|cp|scp)\b[^|;&\n]*(?:\.env\b|id_rsa|\.pem\b|\.npmrc|\.netrc|\.aws\/)|\bsecurity\s+find-generic-password\b/ },
  { id: 'sql-drop', label: 'DROP TABLE / DROP DATABASE', re: /\bdrop\s+(?:table|database)\b/i },
  { id: 'pipe-to-shell', label: 'curl or wget piped into a shell', re: /\b(?:curl|wget)\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/ },
  { id: 'npm-publish', label: 'npm publish', re: /\bnpm\s+publish\b/ },
  { id: 'no-verify', label: 'git --no-verify', re: /--no-verify\b/ },
];
const SHELL_TOOLS = new Set(['Bash', 'terminal']);

function commandText(row) {
  const input = row.toolInput;
  if (!input) return '';
  return typeof input === 'string' ? input : String(input.command || '');
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function count(rows, keyFn) {
  const map = {};
  for (const row of rows) {
    const key = keyFn(row);
    map[key] = (map[key] || 0) + 1;
  }
  return map;
}

function sortedEntries(map) {
  return Object.entries(map).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function aggregate({ home, month, through }) {
  const start = `${month}-01`;
  const end = through ? new Date(Date.parse(`${through}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : null;
  if (!end) throw new Error('--through YYYY-MM-DD is required');
  const inRange = (ts) => typeof ts === 'string' && ts >= start && ts < end;

  const events = readJsonl(path.join(home, 'gate-events-log.jsonl')).filter((r) => inRange(r.timestamp));
  const audit = readJsonl(path.join(home, 'audit-trail.jsonl')).filter((r) => inRange(r.timestamp));
  const registry = readJsonl(path.join(home, 'agent-registry.jsonl')).filter((r) => inRange(r.registeredAt));

  const engine = audit.filter((r) => r.source === 'gates-engine');
  const agentActions = engine.filter((r) => !THUMBGATE_TOOLS.has(r.toolName));
  const byDecision = (rows) => ({
    evaluated: rows.length,
    allowed: rows.filter((r) => r.decision === 'allow').length,
    denied: rows.filter((r) => r.decision === 'deny').length,
    warned: rows.filter((r) => r.decision === 'warn').length,
  });

  const shellRows = engine.filter((r) => SHELL_TOOLS.has(r.toolName));
  const commandPatterns = COMMAND_PATTERNS.map(({ id, label, re }) => {
    const hits = shellRows.filter((r) => re.test(commandText(r)));
    return { id, label, ...byDecision(hits) };
  });

  const gateRows = events.filter((e) => e.decision === 'deny' || e.decision === 'warn');
  const byType = {};
  for (const e of gateRows) {
    const type = ACTION_TYPES[e.gateId] || 'Other gate';
    byType[type] = byType[type] || { denied: 0, warned: 0, total: 0 };
    byType[type][e.decision === 'deny' ? 'denied' : 'warned'] += 1;
    byType[type].total += 1;
  }

  return {
    month,
    window: { from: start, through },
    generatedFrom: 'one operator fleet; ThumbGate local logs (gate-events-log, audit-trail, agent-registry)',
    fleet: { agentSessionsRegistered: registry.length },
    gateDecisions: {
      total: gateRows.length,
      denied: gateRows.filter((e) => e.decision === 'deny').length,
      warned: gateRows.filter((e) => e.decision === 'warn').length,
      byActionType: sortedEntries(byType).map(([actionType, v]) => ({ actionType, ...v })),
      byTool: sortedEntries(count(gateRows, (e) => e.toolName || 'unknown')).map(([tool, n]) => ({ tool, count: n })),
    },
    shellCommandPatterns: { shellCommandsEvaluated: shellRows.length, patterns: commandPatterns },
    gateEngineEvaluations: {
      agentActions: byDecision(agentActions),
      agentActionsByTool: sortedEntries(count(agentActions, (r) => r.toolName || 'unknown'))
        .map(([tool, n]) => ({ tool, evaluated: n })),
      thumbgateToolCalls: byDecision(engine.filter((r) => THUMBGATE_TOOLS.has(r.toolName))),
    },
  };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => Number(n).toLocaleString('en-US');

function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function renderPage(data) {
  const label = monthLabel(data.month);
  const g = data.gateDecisions;
  const a = data.gateEngineEvaluations.agentActions;
  const t = data.gateEngineEvaluations.thumbgateToolCalls;
  const sessions = data.fleet.agentSessionsRegistered;
  const title = `What AI coding agents tried to do in ${label} | ThumbGate`;
  const h1 = `What AI coding agents tried to do in ${label}`;
  const description = `${fmt(g.total)} risky agent actions were stopped or flagged by ThumbGate between ${data.window.from} and ${data.window.through}, across ${fmt(sessions)} agent sessions on one operator's own fleet. Counts by action type, with the method and limits.`;
  const url = `https://thumbgate.ai/reports/${data.month}`;
  const rows = g.byActionType.map((r) => `              <tr><td>${esc(r.actionType)}</td><td>${fmt(r.denied)}</td><td>${fmt(r.warned)}</td><td>${fmt(r.total)}</td></tr>`).join('\n');
  const sc = data.shellCommandPatterns;
  const patternRows = sc.patterns.map((r) => `              <tr><td>${esc(r.label)}</td><td>${fmt(r.evaluated)}</td><td>${fmt(r.allowed)}</td><td>${fmt(r.warned)}</td><td>${fmt(r.denied)}</td></tr>`).join('\n');
  const toolRows = data.gateEngineEvaluations.agentActionsByTool.map((r) => `              <tr><td>${esc(r.tool)}</td><td>${fmt(r.evaluated)}</td></tr>`).join('\n');
  const article = {
    '@context': 'https://schema.org', '@type': 'Article', headline: h1, description, url,
    datePublished: data.window.through, dateModified: data.window.through,
    author: { '@type': 'Organization', name: 'ThumbGate', url: 'https://thumbgate.ai' },
    publisher: { '@type': 'Organization', name: 'ThumbGate', url: 'https://thumbgate.ai' },
    mainEntityOfPage: url,
  };
  const dataset = {
    '@context': 'https://schema.org', '@type': 'Dataset', name: `ThumbGate agent gate decisions, ${label}`,
    description: `Aggregate counts of tool calls that ThumbGate denied, warned on or allowed for one operator's own AI coding agents, ${data.window.from} to ${data.window.through}. No commands, paths or customer data.`,
    url, temporalCoverage: `${data.window.from}/${data.window.through}`, license: 'https://opensource.org/licenses/MIT',
    creator: { '@type': 'Organization', name: 'ThumbGate', url: 'https://thumbgate.ai' },
    variableMeasured: ['shell command patterns evaluated', 'denied tool calls by action type', 'warned tool calls by action type', 'agent actions evaluated', 'agent sessions registered'],
    distribution: [{ '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `https://github.com/IgorGanapolsky/ThumbGate/blob/main/public/reports/${data.month}.data.json` }],
    isBasedOn: 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/scripts/build-monthly-report.js',
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${url}" />
  <link rel="canonical" href="${url}" />
  <link rel="icon" type="image/png" href="/thumbgate-icon.png" />
  <meta property="og:image" content="/og.png" />
  <style>
    :root { --bg: #0a0a0b; --bg-card: #161618; --bg-raised: #111113; --line: #222225; --text: #e8e8ec; --muted: #8b8b96; --cyan: #22d3ee; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); line-height: 1.65; }
    a { color: var(--cyan); text-decoration: none; }
    .container { max-width: 860px; margin: 0 auto; padding: 0 24px; }
    .topbar { border-bottom: 1px solid var(--line); }
    .topbar .container { display: flex; justify-content: space-between; align-items: center; padding-top: 14px; padding-bottom: 14px; }
    .brand { font-weight: 700; color: var(--text); display: inline-flex; align-items: center; gap: 8px; }
    h1 { font-size: clamp(30px, 5vw, 48px); line-height: 1.1; letter-spacing: -0.03em; margin: 48px 0 12px; }
    .lede { color: var(--muted); font-size: 18px; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 28px 0; }
    .stat { background: var(--bg-card); border: 1px solid var(--line); border-radius: 14px; padding: 16px; }
    .stat b { display: block; font-size: 32px; letter-spacing: -0.03em; }
    .stat span { color: var(--muted); font-size: 14px; }
    section { background: var(--bg-card); border: 1px solid var(--line); border-radius: 16px; padding: 24px; margin-bottom: 18px; }
    h2 { margin: 0 0 12px; font-size: 22px; letter-spacing: -0.02em; }
    p, li { color: var(--muted); }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { border: 1px solid var(--line); padding: 10px 12px; text-align: left; }
    th { background: var(--bg-raised); color: var(--cyan); }
    td:not(:first-child), th:not(:first-child) { text-align: right; width: 110px; }
    @media (max-width: 600px) { td:not(:first-child), th:not(:first-child) { width: auto; } }
  </style>
  <script type="application/ld+json">
${JSON.stringify(article, null, 2)}
  </script>
  <script type="application/ld+json">
${JSON.stringify(dataset, null, 2)}
  </script>
</head>
<body>
  <header class="topbar"><div class="container">
    <a href="/" class="brand"><img src="/assets/brand/thumbgate-mark-inline-v3.svg" alt="ThumbGate" width="28" height="28" /><span>ThumbGate</span></a>
    <nav><a href="/learn">Learn</a> &nbsp; <a href="/pricing">Pricing</a> &nbsp; <a href="https://github.com/IgorGanapolsky/ThumbGate" target="_blank" rel="noopener">GitHub</a></nav>
  </div></header>
  <main class="container">
    <h1>${esc(h1)}</h1>
    <p class="lede">This is data from our own fleet, not a survey and not customer data. It covers ${data.window.from} to ${data.window.through} on one Mac where ThumbGate gates our own coding agents. It is a small sample, and we say so below.</p>
    <div class="stats">
      <div class="stat"><b>${fmt(g.total)}</b><span>risky actions stopped or flagged (${fmt(g.denied)} denied, ${fmt(g.warned)} warned)</span></div>
      <div class="stat"><b>${fmt(a.evaluated)}</b><span>agent actions the gate checked (${fmt(a.allowed)} allowed, ${fmt(a.denied)} denied, ${fmt(a.warned)} warned)</span></div>
      <div class="stat"><b>${fmt(sessions)}</b><span>agent sessions registered by our agents</span></div>
    </div>
    <section>
      <h2>What the gate stopped or flagged, by action type</h2>
      <table>
        <thead><tr><th>Action type</th><th>Denied</th><th>Warned</th><th>Total</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
      <p>An action type is the rule that fired. Denied means the tool call did not run. Warned means it ran after a warning.</p>
    </section>
    <section>
      <h2>Dangerous-looking shell commands, and what the gate did</h2>
      <p>Of ${fmt(sc.shellCommandsEvaluated)} shell commands the gate engine evaluated, these counts are commands whose text contains each pattern. Zero rows are real zeros in this window.</p>
      <table>
        <thead><tr><th>Command pattern</th><th>Seen</th><th>Allowed</th><th>Warned</th><th>Denied</th></tr></thead>
        <tbody>
${patternRows}
        </tbody>
      </table>
      <p>A command can match a pattern and still be allowed, for example <code>rm -rf</code> on a build folder inside the declared task scope. Pattern matching counts text, so a command that only mentions a pattern (an echo, a commit message) is counted too. The rule table above counts rules that fired, so it can differ from this table when a rule matches a form of the command our text pattern does not.</p>
    </section>
    <section>
      <h2>What the gate allowed</h2>
      <p>Of ${fmt(a.evaluated)} agent actions (shell commands, edits, file reads and writes) the gate engine evaluated, ${fmt(a.allowed)} were allowed, ${fmt(a.denied)} were denied and ${fmt(a.warned)} produced a warning. Separately, agents made ${fmt(t.evaluated)} calls to ThumbGate's own tools (feedback, recall, gate checks); ${fmt(t.allowed)} were allowed and ${fmt(t.denied)} were denied.</p>
      <table>
        <thead><tr><th>Agent action tool</th><th>Checked</th></tr></thead>
        <tbody>
${toolRows}
        </tbody>
      </table>
    </section>
    <section>
      <h2>How we counted, and what this does not show</h2>
      <ul>
        <li><strong>Source.</strong> ThumbGate's own local logs for our agents: the gate event log, the audit trail and the agent registry. The counts come from <a href="https://github.com/IgorGanapolsky/ThumbGate/blob/main/scripts/build-monthly-report.js" target="_blank" rel="noopener">scripts/build-monthly-report.js</a> and the published <a href="https://github.com/IgorGanapolsky/ThumbGate/blob/main/public/reports/${data.month}.data.json" target="_blank" rel="noopener">${data.month}.data.json</a>.</li>
        <li><strong>Sessions, not agents.</strong> An "agent session" is one ThumbGate server start by one of our agents. The same agent restarting counts again, and we cannot separate distinct agents from restarts, so we do not state a fleet size.</li>
        <li><strong>Small sample.</strong> One operator, one machine, ${fmt(g.total)} stopped or flagged actions. Do not read the percentages as industry rates.</li>
        <li><strong>Private by design.</strong> Only counts by rule and tool are published. No commands, file paths, messages, project names or customer data.</li>
        <li><strong>Strict mode.</strong> By default ThumbGate warns on matching destructive actions and denies detected secret exfiltration and gate-bypass attempts; strict mode (<code>THUMBGATE_STRICT_ENFORCEMENT=1</code>) hard-denies the rest. We did not break the counts out by mode.</li>
      </ul>
    </section>
    <section>
      <h2>Run it on your own agents</h2>
      <p><code>npx thumbgate init --agent claude</code> installs the gates; <a href="/pricing">see pricing</a> for what Pro adds.</p>
    </section>
  </main>
</body>
</html>
`;
}

function parseArgs(argv) {
  const out = { home: path.join(os.homedir(), '.thumbgate'), outDir: path.join(ROOT, 'public', 'reports') };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--month') out.month = argv[++i];
    else if (argv[i] === '--through') out.through = argv[++i];
    else if (argv[i] === '--home') out.home = argv[++i];
    else if (argv[i] === '--out-dir') out.outDir = argv[++i];
  }
  if (!/^\d{4}-\d{2}$/.test(out.month || '')) throw new Error('--month YYYY-MM is required');
  return out;
}

function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const data = aggregate(opts);
  fs.mkdirSync(opts.outDir, { recursive: true });
  fs.writeFileSync(path.join(opts.outDir, `${opts.month}.data.json`), `${JSON.stringify(data, null, 2)}\n`);
  fs.writeFileSync(path.join(opts.outDir, `${opts.month}.html`), renderPage(data));
  console.log(`report ${opts.month}: ${data.gateDecisions.total} gate decisions, ${data.gateEngineEvaluations.agentActions.evaluated} agent actions, ${data.fleet.agentSessionsRegistered} sessions`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) main();

module.exports = { ACTION_TYPES, aggregate, renderPage, main };
