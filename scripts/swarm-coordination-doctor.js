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
    const byTitle = new Map();
    for (const issue of open) {
      const key = String(issue.title || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (!key) continue;
      const numbers = byTitle.get(key) || [];
      numbers.push(issue.number);
      byTitle.set(key, numbers);
    }
    const dupes = [...byTitle.entries()].filter(([, numbers]) => numbers.length > 1);
    if (dupes.length > 0) {
      record('github_issues', 'collision', `duplicate open titles ${dupes.map(([, numbers]) => numbers.join('+')).join('; ')}`);
    } else {
      record('github_issues', 'ready', `${open.length} open issue(s); GitHub is the ThumbGate issue board`);
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

function runCommand(bin, args, cwd) {
  return spawnSync(bin, args, {
    cwd,
    encoding: 'utf8',
    timeout: 8000,
  });
}

function collectLiveSnapshot(options = {}) {
  const home = options.home || os.homedir();
  const repoRoot = options.repoRoot || path.join(__dirname, '..');
  const sessionAgent = options.sessionAgent || process.env.THUMBGATE_SESSION_AGENT || '';
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

  const leaseRun = runCommand('node', ['scripts/session-lease.js', 'check'], repoRoot);
  const lease = {
    foreignLive: leaseRun.status === 1,
    detail: String(leaseRun.stdout || leaseRun.stderr || '').trim(),
  };

  const keyPath = path.join(home, '.config', 'linear', 'api_key');
  const linear = {
    authenticated: fs.existsSync(keyPath),
    detail: fs.existsSync(keyPath)
      ? 'Linear API key file is present'
      : 'no api_key at ~/.config/linear/api_key',
    issues: [],
  };

  const issueRun = runCommand('gh', [
    'issue', 'list',
    '--repo', 'IgorGanapolsky/ThumbGate',
    '--state', 'open',
    '--limit', '50',
    '--json', 'number,title',
  ], repoRoot);
  let github;
  if (issueRun.status === 0) {
    try {
      github = { available: true, issues: JSON.parse(issueRun.stdout || '[]') };
    } catch {
      github = { available: false, detail: 'gh issue list returned non-JSON' };
    }
  } else {
    github = { available: false, detail: 'gh issue list unavailable' };
  }

  const notebookPath = path.join(home, 'Documents', 'Igor', 'NotebookLM');
  const gitbutlerRun = runCommand('but', ['status'], repoRoot);
  const gitbutlerText = `${gitbutlerRun.stdout || ''}\n${gitbutlerRun.stderr || ''}`;
  const gitbutler = gitbutlerRun.status === 0
    ? {
      available: true,
      conflicted: /\{conflicted\}/.test(gitbutlerText),
      detail: /\{conflicted\}/.test(gitbutlerText)
        ? 'applied stack is conflicted'
        : 'but status reports no conflicted stack',
    }
    : { available: false, detail: 'but status unavailable' };

  return {
    sessionAgent,
    vaults,
    lease,
    linear,
    github,
    geminiNotebook: {
      exists: fs.existsSync(notebookPath),
      path: notebookPath,
      claimStore: false,
    },
    gitbutler,
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
  parseClaimFile,
  readThumbGateClaims,
  formatReport,
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}
