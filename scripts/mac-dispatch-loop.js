#!/usr/bin/env node
'use strict';

/**
 * mac-dispatch-loop.js — cloud sessions hand work to a Mac through GitHub issues.
 * Polls open `ready-for-agent` issues from allowed authors, claims one (claim comment,
 * earliest claim wins across Macs), runs `claude -p` in the issue's folder under the
 * Mac's own Claude Code permission settings (never adds bypass flags), comments the
 * evidence, and relabels the issue `agent-done` or `agent-blocked`.
 * Usage: --once (launchd) | --watch (herdr pane) [--dry-run]. See docs/guides/mac-dispatch-loop.md.
 */

const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { redactSecrets } = require('./secret-redaction');

const LABELS = Object.freeze({
  ready: { name: 'ready-for-agent', color: '0E8A16', description: 'Queued for a Mac agent run' },
  claimed: { name: 'agent-claimed', color: 'FBCA04', description: 'A Mac agent is working on this' },
  done: { name: 'agent-done', color: '1D76DB', description: 'Mac agent finished; review the evidence comment' },
  blocked: { name: 'agent-blocked', color: 'D93F0B', description: 'Mac agent could not finish; see the evidence comment' },
});

const CLAIM_MARKER = 'mac-dispatch-claim';
const RESULT_MARKER = 'mac-dispatch-result';
const MAX_COMMENT_CHARS = 60000;
const OUTPUT_TAIL_CHARS = 12000;

// Flags that would turn off Claude Code's permission checks. The loop refuses them so
// it always runs under whatever allow/deny rules the Mac owner configured.
const FORBIDDEN_CLAUDE_ARGS = [
  '--dangerously-skip-permissions',
  '--allow-dangerously-skip-permissions',
  'bypassPermissions',
];

function defaultConfig(env = process.env) {
  const home = env.HOME || os.homedir();
  return {
    repo: env.MAC_DISPATCH_REPO || 'IgorGanapolsky/ThumbGate',
    defaultWorkdir: env.MAC_DISPATCH_DEFAULT_WORKDIR || path.join(home, 'workspace', 'ThumbGate'),
    workdirRoots: (env.MAC_DISPATCH_WORKDIR_ROOTS || path.join(home, 'workspace'))
      .split(':')
      .filter(Boolean),
    allowedAuthors: (env.MAC_DISPATCH_ALLOWED_AUTHORS || '').split(',').map((s) => s.trim()).filter(Boolean),
    machineId: env.MAC_DISPATCH_MACHINE_ID || os.hostname(),
    stateDir: env.MAC_DISPATCH_STATE_DIR || path.join(home, '.thumbgate-dispatch'),
    claudeBin: env.MAC_DISPATCH_CLAUDE_BIN || 'claude',
    ghBin: env.MAC_DISPATCH_GH_BIN || 'gh',
    claudeArgs: (env.MAC_DISPATCH_CLAUDE_ARGS || '').split(' ').filter(Boolean),
    timeoutMinutes: Number(env.MAC_DISPATCH_TIMEOUT_MINUTES || 45),
    maxIssues: 1,
    intervalSeconds: 300,
    settleMs: 5000,
    once: false,
    watch: false,
    dryRun: false,
  };
}

function parseArgs(argv, base = defaultConfig()) {
  const config = { ...base, allowedAuthors: [...base.allowedAuthors], workdirRoots: [...base.workdirRoots] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${arg} needs a value`);
      return argv[i];
    };
    switch (arg) {
      case '--once': config.once = true; break;
      case '--watch': config.watch = true; break;
      case '--dry-run': config.dryRun = true; break;
      case '--repo': config.repo = next(); break;
      case '--default-workdir': config.defaultWorkdir = next(); break;
      case '--workdir-root': config.workdirRoots.push(next()); break;
      case '--allow-author': config.allowedAuthors.push(next()); break;
      case '--machine-id': config.machineId = next(); break;
      case '--max-issues': config.maxIssues = Number(next()); break;
      case '--interval': config.intervalSeconds = Number(next()); break;
      case '--timeout-minutes': config.timeoutMinutes = Number(next()); break;
      case '--claude-arg': config.claudeArgs.push(next()); break;
      case '-h':
      case '--help': config.help = true; break;
      default: throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (config.allowedAuthors.length === 0) {
    // Default to the repo owner only. Issue-form labels are applied for anyone who
    // opens an issue on a public repo, so the author check is the trust boundary.
    config.allowedAuthors.push(config.repo.split('/')[0]);
  }
  assertNoPermissionBypass(config.claudeArgs);
  return config;
}

function assertNoPermissionBypass(args) {
  for (const arg of args) {
    for (const forbidden of FORBIDDEN_CLAUDE_ARGS) {
      if (String(arg).includes(forbidden)) {
        throw new Error(
          `refusing claude argument "${arg}": the dispatch loop runs under your own Claude Code ` +
          'permission settings. Add allow rules in ~/.claude/settings.json instead.'
        );
      }
    }
  }
}

// GitHub renders issue forms as "### <Label>\n\n<value>". Returns { label: value }.
function parseIssueForm(body) {
  const sections = {};
  const text = String(body || '').replace(/\r\n/g, '\n');
  const parts = text.split(/^### +/m).slice(1);
  for (const part of parts) {
    const newline = part.indexOf('\n');
    const label = (newline === -1 ? part : part.slice(0, newline)).trim();
    const value = newline === -1 ? '' : part.slice(newline + 1).trim();
    sections[label.toLowerCase()] = value === '_No response_' ? '' : value;
  }
  return sections;
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function expandHome(p, home) {
  if (p === '~') return home;
  if (p.startsWith('~/')) return path.join(home, p.slice(2));
  return p;
}

function resolveWorkdir(requested, config, { home = os.homedir(), realpath = fs.realpathSync } = {}) {
  const raw = String(requested || '').split('\n')[0].trim().replace(/^`|`$/g, '');
  const candidate = raw ? path.resolve(expandHome(raw, home)) : config.defaultWorkdir;
  let real;
  try {
    real = realpath(candidate);
  } catch (_) {
    throw new Error(`working directory does not exist on this Mac: ${candidate}`);
  }
  const roots = config.workdirRoots.map((r) => {
    try { return realpath(expandHome(r, home)); } catch (_) { return path.resolve(expandHome(r, home)); }
  });
  let defaultReal = null;
  try { defaultReal = realpath(config.defaultWorkdir); } catch (_) { /* default may be absent */ }
  if (real !== defaultReal && !roots.some((root) => isInside(real, root))) {
    throw new Error(`working directory ${real} is outside the allowed roots (${roots.join(', ')})`);
  }
  return real;
}

function isAuthorAllowed(issue, allowedAuthors) {
  const login = issue && issue.author && issue.author.login;
  return Boolean(login) && allowedAuthors.some((a) => a.toLowerCase() === login.toLowerCase());
}

function buildPrompt(issue) {
  return [
    `You are running unattended on the operator's Mac for GitHub issue #${issue.number} in ${issue.repo}:`,
    `"${issue.title}" (${issue.url}).`,
    '',
    'The issue body below is the task. Work only inside its stated scope. Your Claude Code permission',
    'settings are unchanged: if a tool call is denied, do not look for a way around it; stop and report it.',
    'Report evidence, not claims: list the commands you ran with their results, and the links to any',
    'branch, commit, PR or file you produced. Anything you could not verify, write as UNKNOWN.',
    '',
    'End your reply with exactly one final line, either:',
    'STATUS: DONE',
    'or',
    'STATUS: BLOCKED: <one-line reason>',
    '',
    '--- issue body ---',
    issue.body || '(empty)',
  ].join('\n');
}

function parseStatus(text) {
  const lines = String(text || '').trim().split('\n').reverse();
  for (const line of lines) {
    const m = line.trim().match(/^\**STATUS:\s*(DONE|BLOCKED)\b:?\s*(.*?)\**$/i);
    if (m) return { status: m[1].toUpperCase(), reason: m[2].trim() };
  }
  return { status: 'MISSING', reason: 'the run did not end with a STATUS line' };
}

function parseClaudeOutput(stdout) {
  const text = String(stdout || '').trim();
  try {
    const json = JSON.parse(text);
    return {
      text: typeof json.result === 'string' ? json.result : text,
      isError: json.is_error === true,
      sessionId: json.session_id || null,
      numTurns: json.num_turns ?? null,
      costUsd: json.total_cost_usd ?? null,
      permissionDenials: Array.isArray(json.permission_denials) ? json.permission_denials.length : null,
    };
  } catch (_) {
    return { text, isError: false, sessionId: null, numTurns: null, costUsd: null, permissionDenials: null };
  }
}

function extractLinks(text) {
  const found = String(text || '').match(/https?:\/\/[^\s)<>\]"'`]+/g) || [];
  return [...new Set(found.map((u) => u.replace(/[.,;:]+$/, '')))].slice(0, 25);
}

function decideOutcome({ exitCode, timedOut, parsed, status }) {
  if (timedOut) return { outcome: 'blocked', reason: 'run hit the timeout and was stopped' };
  if (exitCode !== 0) return { outcome: 'blocked', reason: `claude exited with code ${exitCode}` };
  if (parsed.isError) return { outcome: 'blocked', reason: 'claude reported an error result' };
  if (status.status === 'DONE') return { outcome: 'done', reason: 'run ended with STATUS: DONE' };
  if (status.status === 'BLOCKED') return { outcome: 'blocked', reason: status.reason || 'run reported BLOCKED' };
  return { outcome: 'blocked', reason: status.reason };
}

function fence(text) {
  const body = String(text || '');
  const longest = Math.max(2, ...(body.match(/`+/g) || ['']).map((s) => s.length));
  const ticks = '`'.repeat(longest + 1);
  return `${ticks}text\n${body}\n${ticks}`;
}

function buildEvidenceComment(r) {
  const tail = (s) => (s.length > OUTPUT_TAIL_CHARS ? `…(${s.length - OUTPUT_TAIL_CHARS} earlier chars cut)\n${s.slice(-OUTPUT_TAIL_CHARS)}` : s);
  const unknown = (v) => (v === null || v === undefined || v === '' ? 'UNKNOWN' : String(v));
  const lines = [
    `<!-- ${RESULT_MARKER} claim=${r.claimId} outcome=${r.outcome} -->`,
    `### Mac agent run: **${r.outcome.toUpperCase()}**`,
    '',
    `- Reason: ${r.reason}`,
    `- Machine: \`${r.machineId}\``,
    `- Working directory: \`${r.workdir}\``,
    `- Command: \`${r.command}\` (prompt passed on stdin; permission mode = the Mac's own settings)`,
    `- Started: ${r.startedAt} · Duration: ${Math.round(r.durationMs / 1000)}s`,
    `- Exit code: ${unknown(r.exitCode)}${r.timedOut ? ' (timed out)' : ''}`,
    `- Claude session: ${unknown(r.parsed.sessionId)} · turns: ${unknown(r.parsed.numTurns)} · cost USD: ${unknown(r.parsed.costUsd)} · permission denials: ${unknown(r.parsed.permissionDenials)}`,
    `- Git before: ${unknown(r.gitBefore)}`,
    `- Git after: ${unknown(r.gitAfter)}`,
  ];
  if (r.links.length) {
    lines.push('', '**Links in the output**', ...r.links.map((u) => `- ${u}`));
  }
  lines.push('', '<details><summary>Claude output (tail)</summary>', '', fence(tail(r.outputText)), '', '</details>');
  if (r.stderr && r.stderr.trim()) {
    lines.push('', '<details><summary>stderr (tail)</summary>', '', fence(tail(r.stderr.trim())), '', '</details>');
  }
  lines.push('', `Requeue: remove \`${LABELS[r.outcome].name}\` and add \`${LABELS.ready.name}\`.`);
  let body = redactSecrets(lines.join('\n'));
  if (body.length > MAX_COMMENT_CHARS) body = `${body.slice(0, MAX_COMMENT_CHARS)}\n\n…(comment cut to fit GitHub's limit)`;
  return body;
}

// ---- side effects ---------------------------------------------------------

function makeRunner(spawn = spawnSync) {
  return (cmd, args, opts = {}) => {
    const res = spawn(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
    return {
      status: res.status,
      stdout: res.stdout || '',
      stderr: res.stderr || '',
      error: res.error || null,
      timedOut: Boolean(res.error && res.error.code === 'ETIMEDOUT') || res.signal === 'SIGTERM',
    };
  };
}

function gh(ctx, args, opts = {}) {
  const res = ctx.run(ctx.config.ghBin, args, opts);
  if (res.status !== 0) {
    throw new Error(`gh ${args.slice(0, 3).join(' ')} failed: ${(res.stderr || res.error || '').toString().trim()}`);
  }
  return res.stdout;
}

function ensureLabels(ctx) {
  for (const label of Object.values(LABELS)) {
    gh(ctx, ['label', 'create', label.name, '--repo', ctx.config.repo, '--color', label.color, '--description', label.description, '--force']);
  }
}

function listReadyIssues(ctx) {
  const out = gh(ctx, [
    'issue', 'list', '--repo', ctx.config.repo, '--label', LABELS.ready.name, '--state', 'open',
    '--json', 'number,title,body,author,createdAt,url,labels', '--limit', '50',
  ]);
  return JSON.parse(out || '[]')
    .map((i) => ({ ...i, repo: ctx.config.repo }))
    .sort((a, b) => a.number - b.number);
}

function readyLabeledAt(ctx, issue) {
  const events = JSON.parse(gh(ctx, ['api', '--paginate', '--slurp', `repos/${ctx.config.repo}/issues/${issue.number}/events`]) || '[]').flat();
  const labeled = events.filter((e) => e.event === 'labeled' && e.label && e.label.name === LABELS.ready.name);
  return labeled.length ? labeled[labeled.length - 1].created_at : issue.createdAt;
}

function listComments(ctx, issue) {
  return JSON.parse(gh(ctx, ['api', '--paginate', '--slurp', `repos/${ctx.config.repo}/issues/${issue.number}/comments`]) || '[]').flat();
}

// Picks the winning claim: the earliest claim comment posted since the issue was last
// labeled ready-for-agent. Comment ids only grow, so every machine reaches the same answer.
function pickWinningClaim(comments, sinceIso) {
  const since = Date.parse(sinceIso);
  const re = new RegExp(`<!-- ${CLAIM_MARKER} id=(\\S+) machine=(\\S+) -->`);
  const claims = comments
    .map((c) => ({ c, m: String(c.body || '').match(re) }))
    .filter(({ c, m }) => m && Date.parse(c.created_at) >= since - 1000)
    .sort((a, b) => a.c.id - b.c.id);
  return claims.length ? { claimId: claims[0].m[1], machine: claims[0].m[2], commentId: claims[0].c.id } : null;
}

function claimIssue(ctx, issue) {
  const claimId = crypto.randomBytes(6).toString('hex');
  const since = readyLabeledAt(ctx, issue);
  const body = `<!-- ${CLAIM_MARKER} id=${claimId} machine=${ctx.config.machineId} -->\nClaimed by Mac agent on \`${ctx.config.machineId}\` at ${new Date(ctx.now()).toISOString()}. Running now.`;
  const posted = JSON.parse(gh(ctx, ['api', '-X', 'POST', `repos/${ctx.config.repo}/issues/${issue.number}/comments`, '-f', `body=${body}`]));
  ctx.sleep(ctx.config.settleMs);
  const winner = pickWinningClaim(listComments(ctx, issue), since);
  if (!winner || winner.claimId !== claimId) {
    try {
      gh(ctx, ['api', '-X', 'DELETE', `repos/${ctx.config.repo}/issues/comments/${posted.id}`]);
    } catch (_) { /* a leftover losing claim is harmless: it is never the earliest */ }
    return { won: false, winner };
  }
  gh(ctx, ['issue', 'edit', String(issue.number), '--repo', ctx.config.repo, '--add-label', LABELS.claimed.name, '--remove-label', LABELS.ready.name]);
  return { won: true, claimId };
}

function gitState(ctx, cwd) {
  const head = ctx.run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
  const sha = ctx.run('git', ['rev-parse', '--short', 'HEAD'], { cwd });
  if (head.status !== 0 || sha.status !== 0) return null;
  const dirty = ctx.run('git', ['status', '--porcelain'], { cwd });
  const changed = dirty.status === 0 ? dirty.stdout.split('\n').filter(Boolean).length : 'UNKNOWN';
  return `\`${head.stdout.trim()}\` @ \`${sha.stdout.trim()}\`, ${changed} uncommitted path(s)`;
}

function acquireLock(ctx) {
  const lockDir = path.join(ctx.config.stateDir, 'lock');
  fs.mkdirSync(ctx.config.stateDir, { recursive: true });
  try {
    fs.mkdirSync(lockDir);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    let pid = NaN;
    try { pid = Number(fs.readFileSync(path.join(lockDir, 'pid'), 'utf8')); } catch (_) { /* no pid yet */ }
    let alive = false;
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); alive = true; } catch (e) { alive = e.code === 'EPERM'; }
    }
    if (alive) return null;
    fs.rmSync(lockDir, { recursive: true, force: true });
    fs.mkdirSync(lockDir);
  }
  fs.writeFileSync(path.join(lockDir, 'pid'), String(process.pid));
  return () => fs.rmSync(lockDir, { recursive: true, force: true });
}

function processIssue(ctx, issue) {
  const form = parseIssueForm(issue.body);
  let workdir;
  try {
    workdir = resolveWorkdir(form['working directory'], ctx.config, { home: ctx.home });
  } catch (err) {
    if (ctx.config.dryRun) return { issue: issue.number, action: 'would-block', reason: err.message };
    const claim = claimIssue(ctx, issue);
    if (!claim.won) return { issue: issue.number, action: 'lost-claim' };
    finish(ctx, issue, claim.claimId, 'blocked', `${err.message}`, null);
    return { issue: issue.number, action: 'blocked', reason: err.message };
  }

  const command = [ctx.config.claudeBin, '-p', '--output-format', 'json', ...ctx.config.claudeArgs].join(' ');
  if (ctx.config.dryRun) return { issue: issue.number, action: 'would-run', workdir, command };

  const claim = claimIssue(ctx, issue);
  if (!claim.won) {
    ctx.log(`#${issue.number}: ${claim.winner ? claim.winner.machine : 'another machine'} claimed it first, skipping`);
    return { issue: issue.number, action: 'lost-claim' };
  }

  const startedMs = ctx.now();
  const gitBefore = gitState(ctx, workdir);
  const res = ctx.run(ctx.config.claudeBin, ['-p', '--output-format', 'json', ...ctx.config.claudeArgs], {
    cwd: workdir,
    input: buildPrompt(issue),
    timeout: ctx.config.timeoutMinutes * 60 * 1000,
    killSignal: 'SIGTERM',
  });
  const parsed = parseClaudeOutput(res.stdout);
  const status = parseStatus(parsed.text);
  const { outcome, reason } = decideOutcome({ exitCode: res.status, timedOut: res.timedOut, parsed, status });
  const record = {
    claimId: claim.claimId,
    outcome,
    reason,
    machineId: ctx.config.machineId,
    workdir,
    command,
    startedAt: new Date(startedMs).toISOString(),
    durationMs: ctx.now() - startedMs,
    exitCode: res.status,
    timedOut: res.timedOut,
    parsed,
    gitBefore,
    gitAfter: gitState(ctx, workdir),
    links: extractLinks(`${parsed.text}\n${res.stderr}`),
    outputText: parsed.text,
    stderr: res.error && !res.timedOut ? `${res.stderr}\n${res.error.message}` : res.stderr,
  };
  finish(ctx, issue, claim.claimId, outcome, reason, record);
  return { issue: issue.number, action: outcome, reason };
}

function finish(ctx, issue, claimId, outcome, reason, record) {
  const body = record
    ? buildEvidenceComment(record)
    : `<!-- ${RESULT_MARKER} claim=${claimId} outcome=${outcome} -->\n### Mac agent run: **${outcome.toUpperCase()}**\n\n- Reason: ${reason}\n- Machine: \`${ctx.config.machineId}\`\n- Claude was not started.\n\nRequeue: fix the issue, remove \`${LABELS[outcome].name}\` and add \`${LABELS.ready.name}\`.`;
  gh(ctx, ['issue', 'comment', String(issue.number), '--repo', ctx.config.repo, '--body-file', '-'], { input: body });
  gh(ctx, ['issue', 'edit', String(issue.number), '--repo', ctx.config.repo, '--add-label', LABELS[outcome].name, '--remove-label', LABELS.claimed.name]);
  appendReceipt(ctx, { issue: issue.number, url: issue.url, outcome, reason, claimId, at: new Date(ctx.now()).toISOString() });
}

function appendReceipt(ctx, entry) {
  try {
    fs.mkdirSync(ctx.config.stateDir, { recursive: true });
    fs.appendFileSync(path.join(ctx.config.stateDir, 'receipts.jsonl'), `${JSON.stringify(entry)}\n`);
  } catch (err) {
    ctx.log(`could not write receipt: ${err.message}`);
  }
}

function tick(ctx) {
  const release = ctx.config.dryRun ? () => {} : acquireLock(ctx);
  if (!release) {
    ctx.log('another dispatch run is active on this Mac, skipping this tick');
    return [];
  }
  try {
    if (!ctx.config.dryRun) ensureLabels(ctx);
    const issues = listReadyIssues(ctx);
    const results = [];
    for (const issue of issues) {
      if (results.filter((r) => r.action !== 'skipped-author' && r.action !== 'lost-claim').length >= ctx.config.maxIssues) break;
      if (!isAuthorAllowed(issue, ctx.config.allowedAuthors)) {
        ctx.log(`#${issue.number}: author ${issue.author && issue.author.login} is not in the allow list, leaving it alone`);
        results.push({ issue: issue.number, action: 'skipped-author' });
        continue;
      }
      try {
        const r = processIssue(ctx, issue);
        ctx.log(`#${issue.number}: ${r.action}${r.reason ? ` (${r.reason})` : ''}`);
        results.push(r);
      } catch (err) {
        ctx.log(`#${issue.number}: error ${err.message}`);
        results.push({ issue: issue.number, action: 'error', reason: err.message });
      }
    }
    if (issues.length === 0) ctx.log('no ready-for-agent issues');
    return results;
  } finally {
    release();
  }
}

function makeContext(config, overrides = {}) {
  return {
    config,
    run: makeRunner(),
    now: () => Date.now(),
    sleep: (ms) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); },
    log: (msg) => console.log(`[mac-dispatch ${new Date().toISOString()}] ${msg}`),
    home: process.env.HOME || os.homedir(),
    ...overrides,
  };
}

const HELP = `Usage: node scripts/mac-dispatch-loop.js (--once | --watch) [options]
  --dry-run              list what would run; no claims, labels or comments
  --repo OWNER/NAME      issue queue (default IgorGanapolsky/ThumbGate)
  --allow-author LOGIN   who may queue work (repeatable; default: repo owner)
  --default-workdir DIR  where to run when the issue names no folder
  --workdir-root DIR     extra allowed parent folder (repeatable)
  --machine-id NAME      name shown in claims (default: hostname)
  --max-issues N         issues per tick (default 1)
  --interval SECONDS     --watch sleep between ticks (default 300)
  --timeout-minutes N    stop a claude run after N minutes (default 45)
  --claude-arg ARG       extra claude flag (repeatable; permission bypass flags are refused)`;

function main(argv = process.argv.slice(2)) {
  const config = parseArgs(argv);
  if (config.help || (!config.once && !config.watch)) {
    console.log(HELP);
    return config.help ? 0 : 2;
  }
  const ctx = makeContext(config);
  if (config.once) {
    const results = tick(ctx);
    return results.some((r) => r.action === 'error') ? 1 : 0;
  }
  for (;;) {
    try { tick(ctx); } catch (err) { ctx.log(`tick failed: ${err.message}`); }
    ctx.sleep(config.intervalSeconds * 1000);
  }
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(`mac-dispatch: ${err.message}`);
    process.exitCode = 2;
  }
}

module.exports = {
  LABELS, CLAIM_MARKER, RESULT_MARKER, FORBIDDEN_CLAUDE_ARGS, defaultConfig, parseArgs,
  assertNoPermissionBypass, parseIssueForm, resolveWorkdir, isAuthorAllowed, buildPrompt,
  parseStatus, parseClaudeOutput, extractLinks, decideOutcome, buildEvidenceComment,
  pickWinningClaim, claimIssue, processIssue, tick, makeContext, makeRunner, acquireLock,
};
