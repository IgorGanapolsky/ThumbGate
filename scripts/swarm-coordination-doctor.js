'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const STALE_CLAIM_MS = 7 * 24 * 60 * 60 * 1000;
const CLOSED_CLAIM = new Set(['done', 'released', 'closed', 'stale']);

function auditSwarmCoordination(snapshot = {}, options = {}) {
  const sessionAgent = String(options.sessionAgent || snapshot.sessionAgent || '').trim();
  const surfaces = [];
  const collisions = [];
  const absences = [];

  function record(name, state, detail) {
    surfaces.push({ name, state, detail });
    if (state === 'collision') collisions.push({ name, detail });
    if (state === 'absence') absences.push({ name, detail });
  }

  if (!sessionAgent) {
    record(
      'session_identity',
      'degraded',
      'THUMBGATE_SESSION_AGENT is unset; this census cannot tell a foreign claim from itself',
    );
  } else {
    record('session_identity', 'ready', `session ${sessionAgent}`);
  }

  const lease = snapshot.lease || {};
  if (lease.foreignLive) {
    record('checkout_lease', 'collision', lease.detail || 'a different live session holds this checkout');
  } else {
    record('checkout_lease', 'ready', lease.detail || 'lease free or held by this session');
  }

  const vaults = Array.isArray(snapshot.vaults) ? snapshot.vaults : [];
  const liveVault = vaults.find((vault) => vault && vault.exists && vault.role === 'live')
    || vaults.find((vault) => vault && vault.exists);
  if (!liveVault) {
    record('obsidian_vault', 'degraded', 'no Obsidian vault directory is present');
  } else {
    const foreign = (liveVault.claims || []).filter((claim) => (
      claim
      && claim.live
      && /thumbgate/i.test(`${claim.topic || ''} ${claim.path || ''}`)
      && claim.owner
      && claim.owner !== sessionAgent
    ));
    if (foreign.length > 0) {
      record(
        'obsidian_vault',
        'collision',
        `live ThumbGate claim held by ${foreign.map((claim) => claim.owner).join(', ')}`,
      );
    } else {
      const namedMissing = vaults.find((vault) => vault && vault.role === 'named' && !vault.exists);
      const note = namedMissing
        ? `live vault ${liveVault.path}; ${namedMissing.path} is absent and is not required`
        : `live vault ${liveVault.path}`;
      record('obsidian_vault', 'ready', note);
    }
  }

  const linear = snapshot.linear || {};
  if (!linear.authenticated) {
    record('linear', 'absence', linear.detail || 'Linear API key absent; GitHub issues stay the ThumbGate board');
  } else if (linear.queryFailed) {
    record('linear', 'degraded', linear.detail || 'Linear query failed; the API key was not printed');
  } else {
    const overlap = (linear.issues || []).filter((issue) => (
      issue
      && /in progress|in review/i.test(String(issue.state || ''))
      && /thumbgate/i.test(String(issue.title || ''))
      && issue.owner
      && issue.owner !== sessionAgent
    ));
    if (overlap.length > 0) {
      record('linear', 'collision', `in-flight ThumbGate issue owned by ${overlap.map((issue) => issue.owner).join(', ')}`);
    } else {
      record('linear', 'ready', `${(linear.issues || []).length} in-flight ThumbGate issue(s) visible`);
    }
  }

  const github = snapshot.github || {};
  if (github.available === false) {
    record('github_issues', 'degraded', github.detail || 'gh issue list unavailable');
  } else {
    const open = Array.isArray(github.issues) ? github.issues : [];
    const dupes = titleCollisions(open);
    if (dupes.length > 0) {
      record('github_issues', 'collision', `duplicate open titles ${dupes.map(([, numbers]) => numbers.join('+')).join('; ')}`);
    } else {
      record('github_issues', 'ready', `${open.length} open issue(s); GitHub is the ThumbGate issue board`);
    }
  }
  if (github.pulls) {
    if (github.pulls.available === false) {
      record('github_pulls', 'degraded', github.pulls.detail || 'gh pr list unavailable');
    } else {
      const openPulls = Array.isArray(github.pulls.items) ? github.pulls.items : [];
      const pullDupes = titleCollisions(openPulls);
      if (pullDupes.length > 0) {
        record(
          'github_pulls',
          'collision',
          `duplicate open pull request titles ${pullDupes.map(([, numbers]) => numbers.join('+')).join('; ')}`,
        );
      } else {
        record('github_pulls', 'ready', `${openPulls.length} open pull request(s); titles are unique`);
      }
    }
  }

  const notebook = snapshot.geminiNotebook || {};
  if (notebook.claimStore) {
    record('gemini_notebook', 'collision', 'NotebookLM is a read mirror, not a claim store');
  } else if (!notebook.exists) {
    record('gemini_notebook', 'absence', 'NotebookLM folder not found; do not invent a notebook sync');
  } else {
    record('gemini_notebook', 'ready', `read mirror at ${notebook.path}`);
  }

  const gitbutler = snapshot.gitbutler || {};
  if (!gitbutler.available) {
    record('gitbutler', 'degraded', gitbutler.detail || 'but status unavailable');
  } else if (gitbutler.conflicted) {
    record('gitbutler', 'collision', gitbutler.detail || 'an applied stack is conflicted');
  } else {
    record('gitbutler', 'ready', gitbutler.detail || 'no conflicted applied stacks');
  }

  const herdr = snapshot.herdr;
  if (herdr) {
    if (herdr.missing || herdr.gatewayDown) {
      record('herdr', 'absence', herdr.detail || 'herdr gateway not running');
    } else if (!herdr.available || herdr.queryFailed) {
      record('herdr', 'degraded', herdr.detail || 'herdr agent list unavailable');
    } else if (Number(herdr.sameCwd) >= 2) {
      record('herdr', 'collision', herdr.detail || `${herdr.sameCwd} herdr agents share this checkout`);
    } else {
      record('herdr', 'ready', herdr.detail || 'herdr gateway up; fewer than two agents in this checkout');
    }
  }

  const typesafe = snapshot.typesafe || {};
  if (typesafe.jevOwnsCoordination || typesafe.cloneJev || typesafe.useTypesafeApiAsCoordinator) {
    record('typesafe_jev', 'collision', 'Jev does not own swarm coordination or the PreToolUse verdict');
  } else {
    record('typesafe_jev', 'ready', 'typed noul/choice/score only; code owns pass|review|block; LLM adjudicator stays parked');
  }

  const swarm = snapshot.swarm || {};
  if (swarm.duplicatePackOwners) {
    record('swarm_context', 'collision', 'two context packs claim the same topic without a handoff');
  } else {
    record('swarm_context', 'ready', 'one shared context pack per distribution; named agents are recipients');
  }

  const degraded = surfaces.some((surface) => surface.state === 'degraded');
  const status = collisions.length > 0 ? 'collision' : degraded ? 'degraded' : 'ready';
  return {
    name: 'thumbgate-swarm-coordination',
    ok: status !== 'collision' && status !== 'degraded',
    status,
    sessionAgent,
    surfaces,
    collisions,
    absences,
    summary: {
      ready: surfaces.filter((surface) => surface.state === 'ready').length,
      absence: absences.length,
      degraded: surfaces.filter((surface) => surface.state === 'degraded').length,
      collision: collisions.length,
    },
  };
}

function parseClaimFile(filePath, now) {
  let text = '';
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  if (!/thumbgate/i.test(text) && !/thumbgate/i.test(path.basename(filePath))) return null;
  const field = (name) => {
    const match = text.match(new RegExp(`^${name}:\\s*(.+)$`, 'im'));
    return match ? match[1].trim() : '';
  };
  const status = field('status').toLowerCase();
  const owner = field('agent_session') || field('owner') || field('agent');
  const topic = field('topic') || path.basename(filePath);
  let live = !CLOSED_CLAIM.has(status);
  try {
    const age = now - fs.statSync(filePath).mtimeMs;
    if (age > STALE_CLAIM_MS) live = false;
  } catch {
    live = false;
  }
  return { path: filePath, topic, owner, status: status || 'unspecified', live };
}

function readThumbGateClaims(vaultPath, now = Date.now()) {
  const roots = [
    path.join(vaultPath, 'Agent-Jobs', 'running'),
    path.join(vaultPath, 'Agents', 'Claims'),
  ];
  const claims = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    let names = [];
    try {
      names = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.md')) continue;
      const claim = parseClaimFile(path.join(root, name), now);
      if (claim) claims.push(claim);
    }
  }
  return claims;
}

function titleCollisions(rows) {
  const byTitle = new Map();
  for (const row of rows || []) {
    const key = String((row && row.title) || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key) continue;
    const numbers = byTitle.get(key) || [];
    numbers.push(row.number);
    byTitle.set(key, numbers);
  }
  return [...byTitle.entries()].filter(([, numbers]) => numbers.length > 1);
}

const NOTEBOOK_SKIP_DIRS = new Set(['Packs', 'node_modules', '.git']);

function readHead(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, 8192, 0);
    return buf.slice(0, n).toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
  }
}

function markdownLooksLikeClaim(text) {
  return /thumbgate/i.test(text) && /^(?:agent_session|owner|agent|status):/im.test(text);
}

function directoryHasClaimMarkdown(dir, depth) {
  if (depth > 4) return false;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || NOTEBOOK_SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (directoryHasClaimMarkdown(full, depth + 1)) return true;
    } else if (entry.isFile() && entry.name.endsWith('.md') && markdownLooksLikeClaim(readHead(full))) {
      return true;
    }
  }
  return false;
}

function notebookIsClaimStore(root) {
  if (!root || !fs.existsSync(root)) return false;
  const claimDirs = [
    path.join(root, 'Agents', 'Claims'),
    path.join(root, 'Agent-Jobs', 'running'),
  ];
  for (const dir of claimDirs) {
    if (!fs.existsSync(dir)) continue;
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    if (names.some((name) => name.endsWith('.md'))) return true;
  }
  return directoryHasClaimMarkdown(root, 0);
}

const LINEAR_QUERY_SOURCE = [
  "const https = require('node:https');",
  "const key = process.env.THUMBGATE_LINEAR_KEY || '';",
  "const query = '{ issues(filter: { and: [ { title: { containsIgnoreCase: \"thumbgate\" } }, { state: { name: { in: [\"In Progress\", \"In Review\"] } } } ] }, first: 50) { nodes { identifier title state { name } assignee { name } } } }';",
  'const body = JSON.stringify({ query });',
  'const req = https.request({',
  "  hostname: 'api.linear.app',",
  "  path: '/graphql',",
  "  method: 'POST',",
  '  headers: {',
  "    'content-type': 'application/json',",
  '    authorization: key,',
  "    'content-length': Buffer.byteLength(body),",
  '  },',
  '  timeout: 7000,',
  '}, (res) => {',
  '  const chunks = [];',
  "  res.on('data', (chunk) => chunks.push(chunk));",
  "  res.on('end', () => {",
  '    process.stdout.write(Buffer.concat(chunks));',
  '    if (res.statusCode !== 200) process.exitCode = 1;',
  '  });',
  '});',
  "req.on('error', () => process.exit(1));",
  "req.on('timeout', () => { req.destroy(); process.exit(1); });",
  'req.end(body);',
].join('\n');

function parseLinearQuery(queryRun) {
  if (!queryRun || queryRun.status !== 0) {
    return {
      authenticated: true,
      queryFailed: true,
      detail: 'Linear query failed; the API key was not printed',
      issues: [],
    };
  }
  try {
    const body = JSON.parse(queryRun.stdout || '');
    const nodes = body && body.data && body.data.issues && body.data.issues.nodes;
    if (body.errors || !Array.isArray(nodes)) {
      return {
        authenticated: true,
        queryFailed: true,
        detail: 'Linear query returned no issue list; the API key was not printed',
        issues: [],
      };
    }
    return {
      authenticated: true,
      queryFailed: false,
      detail: 'Linear in-flight ThumbGate issues queried',
      issues: nodes.map((node) => ({
        number: node.identifier,
        title: node.title,
        state: node.state && node.state.name,
        owner: (node.assignee && node.assignee.name) || '',
      })),
    };
  } catch {
    return {
      authenticated: true,
      queryFailed: true,
      detail: 'Linear query returned non-JSON; the API key was not printed',
      issues: [],
    };
  }
}

function readHerdr(run, repoRoot) {
  const statusRun = run('herdr', ['status'], repoRoot);
  if (statusRun && statusRun.error && statusRun.error.code === 'ENOENT') {
    return { available: false, missing: true, gatewayDown: true, detail: 'herdr binary not installed' };
  }
  const statusText = `${(statusRun && statusRun.stdout) || ''}\n${(statusRun && statusRun.stderr) || ''}`;
  if (!statusRun || statusRun.status !== 0 || !/status:\s*running/.test(statusText)) {
    return { available: false, gatewayDown: true, detail: 'herdr gateway not running' };
  }
  const listRun = run('herdr', ['agent', 'list'], repoRoot);
  if (!listRun || listRun.status !== 0) {
    return { available: true, queryFailed: true, detail: 'herdr agent list failed' };
  }
  let parsed;
  try {
    parsed = JSON.parse(listRun.stdout || '');
  } catch {
    return { available: true, queryFailed: true, detail: 'herdr agent list was not JSON' };
  }
  const agents = Array.isArray(parsed) ? parsed : ((parsed && parsed.agents) || []);
  let checkout = path.resolve(repoRoot);
  try {
    checkout = fs.realpathSync(repoRoot);
  } catch {
    checkout = path.resolve(repoRoot);
  }
  let sameCwd = 0;
  for (const agent of agents) {
    if (!agent || !agent.cwd) continue;
    let agentCwd = path.resolve(agent.cwd);
    try {
      agentCwd = fs.realpathSync(agent.cwd);
    } catch {
      agentCwd = path.resolve(agent.cwd);
    }
    if (agentCwd === checkout) sameCwd += 1;
  }
  const detail = sameCwd >= 2
    ? `${sameCwd} herdr agents share this checkout`
    : `herdr gateway up; ${sameCwd} agent(s) in this checkout`;
  return { available: true, gatewayDown: false, sameCwd, detail };
}

function runCommand(bin, args, cwdOrOptions) {
  const options = (cwdOrOptions && typeof cwdOrOptions === 'object')
    ? cwdOrOptions
    : { cwd: cwdOrOptions };
  const spawnOptions = {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: options.timeout || 8000,
  };
  if (options.env) spawnOptions.env = options.env;
  return spawnSync(bin, args, spawnOptions);
}

function collectLiveSnapshot(options = {}) {
  const home = options.home || os.homedir();
  const repoRoot = options.repoRoot || path.join(__dirname, '..');
  const sessionAgent = options.sessionAgent || process.env.THUMBGATE_SESSION_AGENT || '';
  const run = options.runCommand || runCommand;
  const vaultSpecs = [
    { role: 'named', vaultPath: path.join(home, 'Documents', 'AI-Agent-Sync') },
    { role: 'live', vaultPath: path.join(home, 'Documents', 'Igor') },
  ];
  if (process.env.THUMBGATE_VAULT) {
    vaultSpecs.unshift({ role: 'live', vaultPath: process.env.THUMBGATE_VAULT });
  }
  const vaults = vaultSpecs.map((spec) => ({
    role: spec.role,
    path: spec.vaultPath,
    exists: fs.existsSync(spec.vaultPath),
    claims: fs.existsSync(spec.vaultPath) ? readThumbGateClaims(spec.vaultPath) : [],
  }));

  const leaseRun = run('node', ['scripts/session-lease.js', 'check'], repoRoot) || {};
  const lease = {
    foreignLive: leaseRun.status === 1,
    detail: String(leaseRun.stdout || leaseRun.stderr || '').trim(),
  };

  const keyPath = path.join(home, '.config', 'linear', 'api_key');
  let linear = {
    authenticated: false,
    detail: 'no api_key at ~/.config/linear/api_key',
    issues: [],
  };
  if (fs.existsSync(keyPath)) {
    let key = '';
    try {
      key = fs.readFileSync(keyPath, 'utf8').trim();
    } catch {
      key = '';
    }
    if (!key) {
      linear = {
        authenticated: false,
        detail: 'Linear API key file is empty; GitHub issues stay the ThumbGate board',
        issues: [],
      };
    } else {
      const queryRun = run(process.execPath, ['-e', LINEAR_QUERY_SOURCE], {
        cwd: repoRoot,
        env: { THUMBGATE_LINEAR_KEY: key },
        timeout: 8000,
      });
      linear = parseLinearQuery(queryRun);
    }
  }

  const issueRun = run('gh', [
    'issue', 'list',
    '--repo', 'IgorGanapolsky/ThumbGate',
    '--state', 'open',
    '--limit', '50',
    '--json', 'number,title',
  ], repoRoot) || {};
  let github;
  if (issueRun.status === 0) {
    try {
      github = { available: true, issues: JSON.parse(issueRun.stdout || '[]') };
    } catch {
      github = { available: false, detail: 'gh issue list returned non-JSON', issues: [] };
    }
  } else {
    github = { available: false, detail: 'gh issue list unavailable', issues: [] };
  }

  const pullRun = run('gh', [
    'pr', 'list',
    '--repo', 'IgorGanapolsky/ThumbGate',
    '--state', 'open',
    '--limit', '50',
    '--json', 'number,title',
  ], repoRoot) || {};
  if (pullRun.status === 0) {
    try {
      github.pulls = { available: true, items: JSON.parse(pullRun.stdout || '[]') };
    } catch {
      github.pulls = { available: false, detail: 'gh pr list returned non-JSON', items: [] };
    }
  } else {
    github.pulls = { available: false, detail: 'gh pr list unavailable', items: [] };
  }

  const notebookPath = options.notebookPath || path.join(home, 'Documents', 'Igor', 'NotebookLM');
  const notebookExists = fs.existsSync(notebookPath);
  const gitbutlerRun = run('but', ['status'], repoRoot) || {};
  const gitbutlerText = `${gitbutlerRun.stdout || ''}\n${gitbutlerRun.stderr || ''}`;
  const torn = /please run but teardown/i.test(gitbutlerText);
  const conflicted = torn || /\{conflicted\}/.test(gitbutlerText);
  let gitbutlerDetail = 'but status reports no conflicted stack';
  if (torn) gitbutlerDetail = 'gitbutler workspace is torn';
  else if (conflicted) gitbutlerDetail = 'applied stack is conflicted';
  const gitbutler = gitbutlerRun.status === 0
    ? { available: true, conflicted, detail: gitbutlerDetail }
    : { available: false, detail: 'but status unavailable' };

  return {
    sessionAgent,
    vaults,
    lease,
    linear,
    github,
    geminiNotebook: {
      exists: notebookExists,
      path: notebookPath,
      claimStore: notebookExists ? notebookIsClaimStore(notebookPath) : false,
    },
    gitbutler,
    herdr: readHerdr(run, repoRoot),
    typesafe: {
      jevOwnsCoordination: false,
      cloneJev: false,
      useTypesafeApiAsCoordinator: false,
    },
    swarm: { duplicatePackOwners: false },
  };
}

function formatReport(report) {
  const lines = [
    `swarm coordination: ${report.status}`,
    `session: ${report.sessionAgent || '(unset)'}`,
  ];
  for (const surface of report.surfaces) {
    lines.push(`  ${surface.state.padEnd(10)} ${surface.name}: ${surface.detail}`);
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const strict = args.includes('--strict');
  const sessionFlag = args.find((arg) => arg.startsWith('--session='));
  const fixtureFlag = args.find((arg) => arg.startsWith('--fixture='));
  const sessionAgent = sessionFlag
    ? sessionFlag.slice('--session='.length)
    : (process.env.THUMBGATE_SESSION_AGENT || '');
  let snapshot;
  if (fixtureFlag) {
    snapshot = JSON.parse(fs.readFileSync(fixtureFlag.slice('--fixture='.length), 'utf8'));
  } else if (args.includes('--fixture-collision')) {
    snapshot = {
      sessionAgent,
      lease: { foreignLive: true, detail: 'foreign live lease' },
      vaults: [{ role: 'live', path: '/vault', exists: true, claims: [] }],
      linear: { authenticated: false },
      github: { available: true, issues: [] },
      geminiNotebook: { exists: true, path: '/notebook', claimStore: false },
      gitbutler: { available: true, conflicted: false },
      typesafe: {},
      swarm: {},
    };
  } else {
    snapshot = collectLiveSnapshot({ sessionAgent });
  }
  if (args.includes('--jev-owns-coordination')) {
    snapshot.typesafe = { ...(snapshot.typesafe || {}), jevOwnsCoordination: true };
  }
  const report = auditSwarmCoordination(snapshot, { sessionAgent });
  if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatReport(report));
  if (report.status === 'collision') process.exitCode = 2;
  else if (strict && report.status !== 'ready') process.exitCode = 1;
}

module.exports = {
  auditSwarmCoordination,
  collectLiveSnapshot,
  notebookIsClaimStore,
  parseClaimFile,
  readThumbGateClaims,
  formatReport,
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}
