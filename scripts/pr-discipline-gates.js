#!/usr/bin/env node
'use strict';

/**
 * pr-discipline-gates.js — the owner's anti-babysitting laws for PRs, as hook gates.
 *
 *   pre  (PreToolUse on mcp__github__create_pull_request and Bash `gh pr create`):
 *        deny over 40 files or 1,000 changed lines (split it); deny when an
 *        open PR has the same title or overlaps the same files.
 *   post (PostToolUse) records each PR this session opened.
 *   stop (Stop) blocks ending the session while a PR it opened is red
 *        (failed check), labelled needs-fix / needs-rebase, or conflicts with
 *        its base. Gives up after maxStopBlocks so a session cannot loop.
 *
 * Reply gates (no manual steps, proof before claim) live in
 * reply-discipline-gates.js. Both share the same switch: THUMBGATE_PR_DISCIPLINE=1
 * or <project>/config/pr-discipline.json {"enabled": true}. Fails open on any
 * internal error or network failure: a gate that cannot check never blocks.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DEFAULTS = Object.freeze({
  maxFiles: 40,
  maxLines: 1000,
  titleSimilarity: 0.8,
  fileOverlapRatio: 0.5,
  maxStopBlocks: 3,
});

const PR_CREATE_TOOLS = new Set(['mcp__github__create_pull_request']);
const SIZE_EXCLUDED = [/(^|\/)package-lock\.json$/, /(^|\/)pnpm-lock\.yaml$/, /(^|\/)yarn\.lock$/, /^dist\//, /\.snap$/, /\.map$/, /\.min\.(js|css)$/];
const OVERLAP_IGNORED = [/^\.changeset\//, /(^|\/)CHANGELOG\.md$/, /(^|\/)package(-lock)?\.json$/];

const reply = require('./reply-discipline-gates');

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function parseJson(text, fallback = {}) {
  try { return JSON.parse(text); } catch { return fallback; }
}

function loadConfig(options = {}) {
  return { ...DEFAULTS, ...reply.loadConfig(options) };
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

function makeGithub(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const token = options.token !== undefined ? options.token : (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '');
  const base = options.apiBase || 'https://api.github.com';
  return async function gh(pathname) {
    const res = await fetchImpl(`${base}${pathname}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'thumbgate-pr-discipline',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`GitHub ${pathname}: HTTP ${res.status}`);
    return res.json();
  };
}

function normalizeTitle(title) {
  return String(title || '').toLowerCase()
    .replace(/^\s*(?:feat|fix|chore|docs|test|refactor|perf|ci|build)(?:\([^)]*\))?!?:\s*/, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function titleSimilarity(a, b) {
  const A = new Set(normalizeTitle(a));
  const B = new Set(normalizeTitle(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  return inter / (A.size + B.size - inter);
}

function sizeOf(files) {
  const counted = files.filter((f) => !SIZE_EXCLUDED.some((p) => p.test(f.filename)));
  return {
    files: counted.length,
    lines: counted.reduce((n, f) => n + (f.additions || 0) + (f.deletions || 0), 0),
  };
}

async function evaluatePrCreate(pr, deps = {}) {
  const cfg = { ...DEFAULTS, ...(deps.config || {}) };
  const gh = deps.gh || makeGithub();
  const { owner, repo, head, base, title } = pr;
  if (!owner || !repo || !head) return { deny: false, skipped: 'missing owner/repo/head' };

  // A Bash create runs in a checkout whose branch may not be pushed yet, so the
  // local diff is the source of truth there; the compare API is the fallback.
  let ourFiles = pr.cwd ? localChangedFiles(base || 'main', pr.cwd, deps.git) : null;
  if (!ourFiles) {
    try {
      const compare = await gh(`/repos/${owner}/${repo}/compare/${encodeURIComponent(base || 'main')}...${encodeURIComponent(head)}`);
      ourFiles = Array.isArray(compare.files) ? compare.files : null;
    } catch { ourFiles = null; } // unknown size: still run the title check below
  }
  ourFiles = ourFiles || [];
  const size = sizeOf(ourFiles);
  if (size.files > cfg.maxFiles || size.lines > cfg.maxLines) {
    return {
      deny: true,
      rule: 'pr-size',
      reason: `ThumbGate PR size: ${size.files} files and ${size.lines} changed lines (limit ${cfg.maxFiles} files, ${cfg.maxLines} lines, lockfiles and generated files excluded). Split it into stacked PRs (gh stack) before opening.`,
    };
  }

  const open = await gh(`/repos/${owner}/${repo}/pulls?state=open&per_page=50&sort=updated&direction=desc`);
  const others = (Array.isArray(open) ? open : []).filter((p) => p && p.head && p.head.ref !== head);
  for (const other of others) {
    const sim = titleSimilarity(title, other.title);
    if (sim >= cfg.titleSimilarity) {
      return {
        deny: true,
        rule: 'pr-duplicate',
        reason: `ThumbGate duplicate PR: open PR #${other.number} "${other.title}" has nearly the same title. Push to that PR or close it first.`,
      };
    }
  }
  const ours = ourFiles.map((f) => f.filename).filter((f) => !OVERLAP_IGNORED.some((p) => p.test(f)));
  if (ours.length > 0) {
    const needed = Math.max(1, Math.ceil(ours.length * cfg.fileOverlapRatio));
    for (const other of others.slice(0, 20)) {
      const theirs = await gh(`/repos/${owner}/${repo}/pulls/${other.number}/files?per_page=100`);
      const theirSet = new Set((Array.isArray(theirs) ? theirs : []).map((f) => f.filename));
      const shared = ours.filter((f) => theirSet.has(f));
      if (shared.length >= needed) {
        return {
          deny: true,
          rule: 'pr-duplicate',
          reason: `ThumbGate duplicate PR: open PR #${other.number} "${other.title}" already changes ${shared.length} of these ${ours.length} files (${shared.slice(0, 5).join(', ')}). Build on that PR or wait for it to merge.`,
        };
      }
    }
  }
  return { deny: false, size };
}

function gitOutput(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

/** Files changed from origin/<base> (or <base>) to HEAD, in compare-API shape; null if git can't tell. */
function localChangedFiles(base, cwd, git = gitOutput) {
  for (const ref of [`origin/${base}`, base]) {
    const out = git(['diff', '--numstat', `${ref}...HEAD`], cwd);
    if (!out) continue;
    return out.split('\n').filter(Boolean).map((line) => {
      const [add, del, ...name] = line.split('\t');
      return { filename: name.join('\t'), additions: Number(add) || 0, deletions: Number(del) || 0 };
    });
  }
  return null;
}

// `npm run ship` (scripts/ship.js) opens the PR with gh internally, so it counts as a create.
const SHIP_WRAPPER = /\b(?:npm\s+run\s+ship|node\s+(?:\S*\/)?scripts\/ship\.js)\b/;

function parseGhPrCreate(command) {
  if (!/\bgh\s+pr\s+create\b/.test(String(command || '')) && !SHIP_WRAPPER.test(String(command || ''))) return null;
  const pick = (flag) => {
    const m = String(command).match(new RegExp(`--${flag}(?:=|\\s+)(?:"([^"]*)"|'([^']*)'|(\\S+))`));
    return m ? (m[1] ?? m[2] ?? m[3]) : null;
  };
  return { title: pick('title'), base: pick('base'), head: pick('head'), repo: pick('repo') };
}

function prFromToolInput(toolName, input = {}, payload = {}) {
  if (PR_CREATE_TOOLS.has(toolName)) {
    return { owner: input.owner, repo: input.repo, head: input.head, base: input.base, title: input.title };
  }
  if (toolName === 'Bash') {
    const parsed = parseGhPrCreate(input.command);
    if (!parsed) return null;
    const cwd = payload.cwd || process.cwd();
    let owner;
    let repo;
    if (parsed.repo && parsed.repo.includes('/')) [owner, repo] = parsed.repo.split('/');
    else {
      const m = gitOutput(['remote', 'get-url', 'origin'], cwd).match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/);
      if (m) [, owner, repo] = m;
    }
    return {
      owner,
      repo,
      head: parsed.head || gitOutput(['rev-parse', '--abbrev-ref', 'HEAD'], cwd),
      base: parsed.base || 'main',
      title: parsed.title || gitOutput(['log', '-1', '--format=%s'], cwd),
      cwd,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Session PR ledger + Stop gate
// ---------------------------------------------------------------------------

function ledgerPath(options = {}) {
  const env = options.env || process.env;
  const dir = env.THUMBGATE_PR_LEDGER_DIR || path.join(env.HOME || require('node:os').homedir(), '.thumbgate', 'pr-discipline');
  return path.join(dir, 'session-prs.json');
}

function readLedger(file) {
  return parseJson(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{}', {});
}

function writeLedger(file, ledger) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
}

function extractPrUrls(response) {
  const text = typeof response === 'string' ? response : JSON.stringify(response || '');
  const found = new Map();
  const re = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g;
  let m;
  while ((m = re.exec(text))) found.set(`${m[1]}/${m[2]}#${m[3]}`, { owner: m[1], repo: m[2], number: Number(m[3]) });
  return [...found.values()];
}

function recordOpenedPrs(payload, options = {}) {
  const toolName = payload.tool_name || '';
  const isCreate = PR_CREATE_TOOLS.has(toolName) || (toolName === 'Bash' && parseGhPrCreate(payload.tool_input && payload.tool_input.command));
  if (!isCreate) return [];
  const prs = extractPrUrls(payload.tool_response);
  if (prs.length === 0) return [];
  const file = ledgerPath(options);
  const ledger = readLedger(file);
  const sid = payload.session_id || 'unknown';
  const entry = ledger[sid] || { prs: [], stopBlocks: 0 };
  for (const pr of prs) {
    if (!entry.prs.some((p) => p.owner === pr.owner && p.repo === pr.repo && p.number === pr.number)) entry.prs.push({ ...pr, openedAt: new Date().toISOString() });
  }
  ledger[sid] = entry;
  writeLedger(file, ledger);
  return prs;
}

async function prProblems(pr, gh) {
  const data = await gh(`/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`);
  if (data.state !== 'open' || data.merged) return [];
  const labels = (data.labels || []).map((l) => l.name);
  if (labels.includes('needs-igor') || labels.includes('do-not-merge')) return []; // waiting on the owner, not on the agent
  const problems = [];
  if (labels.includes('needs-fix')) problems.push('labelled needs-fix');
  if (labels.includes('needs-rebase')) problems.push('labelled needs-rebase');
  if (data.mergeable_state === 'dirty') problems.push('has merge conflicts with its base (needs rebase)');
  const sha = data.head && data.head.sha;
  if (sha) {
    const runs = await gh(`/repos/${pr.owner}/${pr.repo}/commits/${sha}/check-runs?per_page=100`);
    const failed = (runs.check_runs || []).filter((r) => ['failure', 'timed_out', 'cancelled', 'action_required'].includes(r.conclusion));
    if (failed.length > 0) problems.push(`red checks: ${failed.map((r) => r.name).slice(0, 5).join(', ')}`);
  }
  return problems;
}

async function evaluateStop(payload, options = {}) {
  const cfg = { ...DEFAULTS, ...(options.config || {}) };
  const reasons = [];

  const file = ledgerPath(options);
  const ledger = readLedger(file);
  const sid = payload.session_id || 'unknown';
  const entry = ledger[sid];
  if (entry && entry.prs.length > 0) {
    const gh = options.gh || makeGithub();
    for (const pr of entry.prs) {
      try {
        const problems = await prProblems(pr, gh);
        if (problems.length > 0) reasons.push(`PR ${pr.owner}/${pr.repo}#${pr.number} that you opened ${problems.join('; ')}. Fix it before ending.`);
      } catch { /* cannot check: fail open for this PR */ }
    }
  }
  if (reasons.length === 0) {
    if (entry && entry.stopBlocks) { entry.stopBlocks = 0; writeLedger(file, ledger); }
    return { block: false };
  }
  const counter = entry || { prs: [], stopBlocks: 0 };
  ledger[sid] = counter;
  const blocks = counter.stopBlocks || 0;
  if (blocks >= cfg.maxStopBlocks) {
    // Avoid an endless loop when the agent truly cannot fix it: let it stop,
    // but say why, so the reply reports it.
    counter.stopBlocks = 0;
    writeLedger(file, ledger);
    return { block: false, warning: `ThumbGate anti-babysitting (after ${blocks} blocks): ${reasons.join(' ')}` };
  }
  counter.stopBlocks = blocks + 1;
  writeLedger(file, ledger);
  return { block: true, reason: `ThumbGate anti-babysitting: ${reasons.join(' ')}` };
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

async function runPre(payload, options = {}) {
  const toolName = payload.tool_name || '';
  const input = payload.tool_input || {};
  const pr = prFromToolInput(toolName, input, payload);
  if (pr) return evaluatePrCreate(pr, options);
  return { deny: false };
}

async function main(mode = process.argv[2], options = {}) {
  const payload = parseJson(options.stdin !== undefined ? options.stdin : readStdin(), {});
  const config = loadConfig({ cwd: payload.cwd, env: options.env });
  const out = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
  if (!config.enabled) { out({}); return 0; }
  try {
    if (mode === 'pre') {
      const r = await runPre(payload, { ...options, config });
      if (r.deny) {
        out({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: r.reason } });
      } else out({});
    } else if (mode === 'post') {
      recordOpenedPrs(payload, options);
      out({});
    } else if (mode === 'stop') {
      const r = await evaluateStop(payload, { ...options, config });
      if (r.block) out({ decision: 'block', reason: r.reason });
      else if (r.warning) out({ systemMessage: r.warning });
      else out({});
    } else out({});
  } catch (err) {
    process.stderr.write(`pr-discipline-gates: ${err && err.message}\n`);
    out({}); // fail open
  }
  return 0;
}

module.exports = {
  DEFAULTS,
  loadConfig,
  makeGithub,
  titleSimilarity,
  sizeOf,
  evaluatePrCreate,
  parseGhPrCreate,
  localChangedFiles,
  prFromToolInput,
  extractPrUrls,
  recordOpenedPrs,
  prProblems,
  evaluateStop,
  runPre,
  main,
};

if (require.main === module) {
  main().then((code) => { process.exitCode = code; });
}
