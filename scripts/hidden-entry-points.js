#!/usr/bin/env node
'use strict';

/**
 * Hidden-entry-points scorecard — misconfigs attackers / runaway agents rely on.
 *
 * Process steal from a BrightTALK weekly rec digest (not BrightTALK, SailPoint,
 * Strike48, Abnormal, A-LIGN, or ISO 42001 product):
 *   - "Watch everything" is not the digest — rank by interest, drop vendor theater
 *   - Hidden entry points = PreToolUse / identity / dynamic-tool misconfigs
 *   - Going agentic without a pre-action gate is the SOC pitfall
 *
 * Existing surfaces: agent-security-central hook drift + claw evaluateClawPretool.
 * Not a new SOC / ISO 42001 SKU. Not BrightTALK affiliation.
 *
 * Usage:
 *   node scripts/hidden-entry-points.js
 *   node scripts/hidden-entry-points.js --json
 *   npm run hidden:entry
 */

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = 'thumbgate.hidden_entry_points.v1';
const DEFAULT_INTERESTS = ['hidden-entry', 'identity', 'agentic-soc', 'ai-security'];
const DEFAULT_MAX_DIGEST = 5;

/**
 * Fixture set: load-all is "watch every webinar"; digest is interest-ranked.
 * `iso42001-theater` and vendor webinars are noise (not attacker entry points).
 */
const ENTRY_POINTS = [
  {
    id: 'pretooluse-unwired',
    theme: 'hidden-entry',
    label: 'PreToolUse hook not on the wire',
    attackerReliesOn: true,
    noise: false,
    open: true,
    severity: 9,
  },
  {
    id: 'dynamic-tool-ungated',
    theme: 'agentic-soc',
    label: 'Runtime dynamic tool creation without approval',
    attackerReliesOn: true,
    noise: false,
    open: true,
    severity: 8,
  },
  {
    id: 'computer-use-ungated',
    theme: 'hidden-entry',
    label: 'Screen / computer-use without a pre-action gate',
    attackerReliesOn: true,
    noise: false,
    open: true,
    severity: 8,
  },
  {
    id: 'agent-identity-missing',
    theme: 'identity',
    label: 'Tool calls without agent_identity',
    attackerReliesOn: true,
    noise: false,
    open: true,
    severity: 7,
  },
  {
    id: 'review-volume-as-control',
    theme: 'agentic-soc',
    label: 'Human review volume treated as the control',
    attackerReliesOn: true,
    noise: false,
    open: true,
    severity: 6,
  },
  {
    id: 'iso42001-theater',
    theme: 'compliance',
    label: 'Treat ISO 42001 marketing as an attestation',
    attackerReliesOn: false,
    noise: true,
    open: false,
    severity: 1,
  },
  {
    id: 'vendor-webinar-sailpoint',
    theme: 'identity',
    label: 'SailPoint / BrightTALK vendor webinar as a product claim',
    attackerReliesOn: false,
    noise: true,
    open: false,
    severity: 0,
  },
];

function rankDigest(entries, options = {}) {
  const interests = Array.isArray(options.interests) && options.interests.length
    ? options.interests
    : DEFAULT_INTERESTS;
  const maxDigest = Number.isFinite(options.maxDigest) && options.maxDigest > 0
    ? options.maxDigest
    : DEFAULT_MAX_DIGEST;
  const interestSet = new Set(interests);
  return [...entries]
    .filter((e) => !e.noise && interestSet.has(e.theme))
    .sort((a, b) => (b.severity || 0) - (a.severity || 0))
    .slice(0, maxDigest);
}

function applyLiveHookDrift(entries, projectRoot, homeDir) {
  if (!projectRoot) return { entries, error: null };
  try {
    const { assessHookDrift } = require('./agent-security-central');
    const assessment = assessHookDrift(projectRoot, homeDir);
    const drifted = Boolean(assessment && assessment.drifted);
    return {
      entries: entries.map((e) => (
        e.id === 'pretooluse-unwired' ? { ...e, open: drifted } : e
      )),
      error: null,
    };
  } catch (err) {
    return {
      entries,
      error: `Live hook drift assessment failed: ${err.message}`,
    };
  }
}

function runHiddenEntryScorecard(options = {}) {
  const base = Array.isArray(options.entries) && options.entries.length
    ? options.entries
    : ENTRY_POINTS;
  const { entries, error: liveError } = applyLiveHookDrift(base, options.projectRoot, options.homeDir);
  const loadAll = entries.map((e) => e.id);
  const digest = rankDigest(entries, options);
  const openAttacker = entries.filter((e) => e.attackerReliesOn && e.open);
  const noiseDropped = entries.filter((e) => e.noise).map((e) => e.id);
  const digestIds = digest.map((e) => e.id);
  const digestHasNoise = digest.some((e) => e.noise);
  const digestHasClosedTheater = digest.some((e) => !e.attackerReliesOn);

  const failures = [];
  if (liveError) {
    failures.push(liveError);
  }
  if (openAttacker.length === 0) {
    failures.push('no open hidden entry — fixture is not a misconfig case');
  }
  if (digest.length === 0) {
    failures.push('interest digest is empty');
  }
  if (digest.length >= loadAll.length) {
    failures.push('digest did not rank — load-all still shown');
  }
  if (digestHasNoise || digestHasClosedTheater) {
    failures.push('digest still contains vendor/ISO theater');
  }
  if (!digestIds.includes('pretooluse-unwired') && openAttacker.some((e) => e.id === 'pretooluse-unwired')) {
    failures.push('open PreToolUse miss not in digest');
  }

  return {
    schema: SCHEMA,
    mode: options.projectRoot ? 'live-overlay' : 'simulation',
    generatedAt: new Date().toISOString(),
    autoApply: false,
    humanOversightRequired: true,
    reviewVolumeIsNotTheControl: true,
    capturedRevenueUsd: 0,
    affiliation: 'none',
    iso42001Certified: false,
    process: {
      source: 'BrightTALK weekly-rec process — not BrightTALK/SailPoint/ISO 42001 product',
      interestRankedDigest: true,
      unifiedAlertManager: false,
    },
    interests: options.interests || DEFAULT_INTERESTS,
    loadAll,
    digest: digestIds,
    openAttacker: openAttacker.map((e) => e.id),
    noiseDropped,
    summary: {
      ok: failures.length === 0,
      failures,
    },
    disclaimers: [
      'SIMULATION unless --project. Does not install hooks.',
      'Not BrightTALK, SailPoint, Strike48, Abnormal, A-LIGN, or ISO 42001.',
      'Review volume is not the control — PreToolUse is. capturedRevenueUsd is 0.',
      'ThumbGate is not ISO 42001 certified. Do not treat this scorecard as an attestation.',
    ],
  };
}

function formatReport(report) {
  return [
    '# Hidden entry points vs interest digest',
    '',
    `Result: ${report.summary.ok ? 'PASS' : 'FAIL'}  open=${(report.openAttacker || []).length}`,
    '',
    `| Path | Count |`,
    `|------|------:|`,
    `| Load-all webinars | ${report.loadAll.length} |`,
    `| Interest digest | ${report.digest.length} |`,
    `| Open attacker entries | ${report.openAttacker.length} |`,
    '',
    `Digest: ${(report.digest || []).join(', ') || '—'}`,
    `Noise dropped: ${(report.noiseDropped || []).join(', ') || '—'}`,
    `iso42001Certified=${report.iso42001Certified}  autoApply=${report.autoApply}  capturedRevenueUsd=${report.capturedRevenueUsd}`,
    '',
    ...report.disclaimers.map((d) => `- ${d}`),
    '',
  ].join('\n');
}

function mainCli(argv = process.argv.slice(2)) {
  const json = argv.includes('--json');
  const writeIdx = argv.indexOf('--write');
  let writePath = null;
  if (writeIdx >= 0) {
    const candidate = argv[writeIdx + 1];
    if (!candidate || candidate.startsWith('-')) {
      process.stderr.write('Error: --write requires a valid file path\n');
      return 1;
    }
    writePath = candidate;
  }
  const projectIdx = argv.indexOf('--project');
  let projectRoot = null;
  if (projectIdx >= 0) {
    const candidate = argv[projectIdx + 1];
    if (!candidate || candidate.startsWith('-')) {
      process.stderr.write('Error: --project requires a valid directory path\n');
      return 1;
    }
    projectRoot = candidate;
  }
  const report = runHiddenEntryScorecard(projectRoot ? { projectRoot } : {});

  if (writePath) {
    const abs = path.resolve(writePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const jsonPath = /\.json$/i.test(abs) ? abs : `${abs}.json`;
    fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatReport(report));
  }
  return report.summary.ok ? 0 : 1;
}

module.exports = {
  SCHEMA,
  DEFAULT_INTERESTS,
  ENTRY_POINTS,
  rankDigest,
  runHiddenEntryScorecard,
  formatReport,
  mainCli,
};

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  process.exitCode = mainCli();
}
