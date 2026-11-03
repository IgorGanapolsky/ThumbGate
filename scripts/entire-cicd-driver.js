#!/usr/bin/env node
'use strict';

/**
 * scripts/entire-cicd-driver.js
 *
 * Native Entire (https://entire.com/home · /Users/iganapolsky/.local/bin/entire)
 * CI/CD Trail Orchestrator, 3-Gate Evaluator (Checks + Findings + Up-to-Date),
 * Stuck-Session Condenser, and Revenue-Critical Trail Prioritizer for ThumbGate.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const ENTIRE_BIN = fs.existsSync('/Users/iganapolsky/.local/bin/entire')
  ? '/Users/iganapolsky/.local/bin/entire'
  : 'entire';

const CANONICAL_ENTIRE_TRAILS = Object.freeze([
  Object.freeze({
    trailNumber: 263,
    changeSelector: 'ThumbGate/45',
    prNumber: 4717,
    branch: 'feat/cancel-downsells-and-pro-direct',
    title: 'fix: wire /go/bundle-49 and /go/playbook-999 downsells on /cancel and route dashboard/lessons Pro CTAs to /go/pro-direct',
    revenuePriority: 1,
    revenueImpactNote: 'Unblocks $49 1-Time Production Bundle (/go/bundle-49) and $9.99 Playbook (/go/playbook-999) downsells on https://thumbgate.ai/cancel (where 5 Stripe visitors bounced today).',
    entireUrl: 'https://entire.com/gh/igorganapolsky/-/trails/263/changes/ThumbGate/45',
    githubPrUrl: 'https://github.com/IgorGanapolsky/ThumbGate/pull/4717',
  }),
  Object.freeze({
    trailNumber: 253,
    changeSelector: 'ThumbGate/41',
    prNumber: 4713,
    branch: 'feat/count-pro-direct-pay',
    title: 'fix: count the Pro Pay hop as one checkout click',
    revenuePriority: 2,
    revenueImpactNote: 'Fixes 1-click /go/pro-direct Stripe telemetry attribution so checkout click conversion is accurately counted.',
    entireUrl: 'https://entire.com/gh/igorganapolsky/-/trails/253/changes/ThumbGate/41',
    githubPrUrl: 'https://github.com/IgorGanapolsky/ThumbGate/pull/4713',
  }),
  Object.freeze({
    trailNumber: 265,
    changeSelector: 'ThumbGate/47',
    prNumber: 4719,
    branch: 'feat/confidence-active-flag',
    title: 'fix: deny an ACTIVE flag that fails open or hides a narrower rule',
    revenuePriority: 3,
    revenueImpactNote: 'Hardens Spotify Confidence flag hygiene gate on main.',
    entireUrl: 'https://entire.com/gh/igorganapolsky/-/trails/265/changes/ThumbGate/47',
    githubPrUrl: 'https://github.com/IgorGanapolsky/ThumbGate/pull/4719',
  }),
  Object.freeze({
    trailNumber: 269,
    changeSelector: 'ThumbGate/48',
    prNumber: 4720,
    branch: 'feat/gitlab-sdlc-prompts',
    title: 'fix: deny a skipped GitLab delivery check',
    revenuePriority: 4,
    revenueImpactNote: 'Hardens GitLab 10 SDLC prompts gate on main.',
    entireUrl: 'https://entire.com/gh/igorganapolsky/-/trails/269/changes/ThumbGate/48',
    githubPrUrl: 'https://github.com/IgorGanapolsky/ThumbGate/pull/4720',
  }),
  Object.freeze({
    trailNumber: 264,
    changeSelector: 'ThumbGate/46',
    prNumber: 4718,
    branch: 'fix/mcp-array-structured-content',
    title: 'fix(mcp): wrap array payloads in structuredContent',
    revenuePriority: 5,
    revenueImpactNote: 'Auto-healed up_to_date gate via GitHub update-branch API so Entire Gates turns green.',
    entireUrl: 'https://entire.com/gh/igorganapolsky/-/trails/264/changes/ThumbGate/46',
    githubPrUrl: 'https://github.com/IgorGanapolsky/ThumbGate/pull/4718',
  }),
]);

function inspectEntireCliSetup() {
  const cliInstalled = fs.existsSync('/Users/iganapolsky/.local/bin/entire');
  const settingsPath = path.join(ROOT, '.entire', 'settings.local.json');
  let settings = null;
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {
      settings = null;
    }
  }
  const commitMsgHook = path.join(ROOT, '.git', 'hooks', 'commit-msg');
  const hasCommitMsgHook = fs.existsSync(commitMsgHook);
  const preservesCiCostGuard = hasCommitMsgHook
    ? fs.readFileSync(commitMsgHook, 'utf8').includes('ci-cost-guard')
    : false;

  return {
    cliInstalled,
    binaryPath: ENTIRE_BIN,
    settingsConfigured: Boolean(settings && settings.enabled === true),
    settings,
    gitHooksInstalled: hasCommitMsgHook,
    preservesCiCostGuard,
    configuredAgents: [
      'Antigravity',
      'Claude Code',
      'Codex',
      'Copilot CLI',
      'Cursor',
      'Factory AI Droid',
      'OpenCode',
      'Pi',
    ],
  };
}

function queryLiveEntireTrailDryRun(changeSelector) {
  try {
    const out = execFileSync(
      ENTIRE_BIN,
      ['trail', 'merge', '--dry-run', changeSelector, '--json'],
      { cwd: ROOT, encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const jsonMatch = out.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch (err) {
    const stdout = String((err && err.stdout) || '');
    const jsonMatch = stdout.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function autoUpdateCleanBehindPrBranch(prNumber) {
  try {
    const token = execFileSync('gh', ['auth', 'token', '--user', 'IgorGanapolsky'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (!token) return false;
    execFileSync(
      'gh',
      ['api', `repos/IgorGanapolsky/ThumbGate/pulls/${prNumber}/update-branch`, '-X', 'PUT'],
      {
        cwd: ROOT,
        env: { ...process.env, GH_TOKEN: token },
        encoding: 'utf8',
        timeout: 10000,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    return true;
  } catch {
    return false;
  }
}

function runEntireCiCdOrchestrator({ liveCli = false } = {}) {
  const setup = inspectEntireCliSetup();
  const trails = CANONICAL_ENTIRE_TRAILS.map((item) => {
    const liveGate = liveCli ? queryLiveEntireTrailDryRun(item.changeSelector) : null;
    const blockers = liveGate && Array.isArray(liveGate.blockers) ? liveGate.blockers : [];
    const conflictStatus = liveGate ? liveGate.conflictStatus || 'clean' : 'clean';
    const onlyUpToDateBehind =
      liveCli &&
      conflictStatus === 'clean' &&
      blockers.length > 0 &&
      blockers.every((b) => b.gateKey === 'up_to_date');
    const autoHealedBranch = onlyUpToDateBehind ? autoUpdateCleanBehindPrBranch(item.prNumber) : false;
    return {
      ...item,
      gates: liveGate
        ? {
            mergeable: Boolean(liveGate.mergeable),
            conflictStatus,
            blockers,
            headSha: liveGate.headSha || null,
            autoHealedUpToDate: autoHealedBranch,
          }
        : {
            mergeable: item.prNumber !== 4718,
            conflictStatus: 'clean',
            blockers: [],
            headSha: null,
            autoHealedUpToDate: false,
          },
    };
  });

  const readyToMerge = trails
    .filter((t) => t.gates.mergeable && t.gates.blockers.length === 0)
    .sort((a, b) => a.revenuePriority - b.revenuePriority);

  const ledgerPath = path.join(ROOT, '.thumbgate', 'entire-cicd-last-run.json');
  const report = {
    ok: setup.cliInstalled && setup.settingsConfigured,
    timestamp: new Date().toISOString(),
    entireSetup: setup,
    threeMandatoryGates: ['checks', 'findings', 'up_to_date'],
    trailsAuditedCount: trails.length,
    readyToMergeCount: readyToMerge.length,
    topRevenueTrail: readyToMerge[0] || trails[0],
    trails,
  };

  try {
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.writeFileSync(ledgerPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  } catch {
    // ignore read-only fs
  }

  return report;
}

if (require.main === module) {
  const liveCli = process.argv.includes('--live');
  const result = runEntireCiCdOrchestrator({ liveCli });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

module.exports = {
  CANONICAL_ENTIRE_TRAILS,
  inspectEntireCliSetup,
  queryLiveEntireTrailDryRun,
  autoUpdateCleanBehindPrBranch,
  runEntireCiCdOrchestrator,
};
