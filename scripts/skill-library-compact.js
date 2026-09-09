#!/usr/bin/env node
'use strict';

/**
 * SkillGLoW FORMAT steal: remember reusable procedures, not every past task.
 * Admit a prior only when measured execution does not degrade the library.
 *
 * Public source:
 *   https://arxiv.org/abs/2609.02217
 *   https://x.com/rohanpaul_ai/status/2096336455375425893
 *
 * Steal the FORMAT (procedural family, de-instantiate instance detail,
 * execution commit gate). Do not clone SkillGLoW / GLoW, do not train
 * an ALFWorld skill library, do not vendor their weave optimizer.
 *
 * Complementary to scripts/feedback-to-rules.js (procedure promotion),
 * scripts/lesson-canonical.js (wording collapse), and
 * scripts/memory-vs-rag.js (memory ≠ transcript dump). Do not dual-edit
 * those files or DIRTY lesson-graph PR #3650.
 *
 * ECI: inventory/honesty doctor on pre-existing memory rails, not a
 * net-new self-improving-agent SKU.
 */

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 'thumbgate.skill-library-compact.v1';
const DEFAULT_ROOT = path.join(__dirname, '..');

const SURFACES = Object.freeze({
  feedbackToRules: 'scripts/feedback-to-rules.js',
  lessonCanonical: 'scripts/lesson-canonical.js',
  memoryVsRag: 'scripts/memory-vs-rag-route.js',
  memoryFirewall: 'scripts/memory-firewall.js',
  skillProgressive: 'tests/skill-progressive-disclosure.test.js',
});

const INSTANCE_MARKERS = [
  /[0-9a-f]{40}/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\/Users\/[^\s]+/,
  /\bsession-[a-z0-9-]{8,}\b/i,
  /\bpull\/\d+\b/i,
];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function textOf(entry) {
  if (entry == null) return '';
  if (typeof entry === 'string') return entry;
  return String(entry.body || entry.text || entry.rule || entry.content || '');
}

function isGenericDocument(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return true;
  if (t.length < 24) return true;
  return /be careful|always think|try your best|use good judgment/.test(t);
}

function isInstanceBound(text) {
  const t = String(text || '');
  return INSTANCE_MARKERS.some((re) => re.test(t));
}

function evaluateLibrary(input = {}) {
  const episodes = asArray(input.episodes);
  const procedures = asArray(input.procedures);
  const families = asArray(input.families).map((row) => String(row || '').trim()).filter(Boolean);
  const form = String(input.form || '').trim().toLowerCase();
  const commit = input.commit === true;
  const executionMeasured = input.executionMeasured === true;
  const executionDelta = input.executionDelta;
  const modelSaidBetter = input.modelSaidBetter === true;

  const issues = [];

  if (procedures.length === 0 && episodes.length === 0 && families.length === 0) {
    issues.push('library_inventory_unavailable');
  }

  if (form === 'single_document' || (procedures.length === 1 && isGenericDocument(textOf(procedures[0])))) {
    issues.push('generic_document_collapse');
  }

  const familyCount = families.length;
  if (
    (episodes.length > 0 && procedures.length === episodes.length && familyCount === 0)
    || (familyCount > 0 && procedures.length > familyCount * 2)
  ) {
    issues.push('per_task_pool_inflation');
  }

  const bound = procedures.some((row) => row && row.instanceBound === true || isInstanceBound(textOf(row)));
  if (bound) issues.push('instance_bound_not_deinstantiated');

  if (commit) {
    if (!executionMeasured) issues.push('commit_without_execution_gate');
    if (typeof executionDelta === 'number' && executionDelta < 0) {
      issues.push('commit_degrades_library');
    }
  }

  if (modelSaidBetter) issues.push('model_cannot_grant_authority');

  const decision = issues.length ? 'deny' : 'allow';
  return {
    schemaVersion: SCHEMA_VERSION,
    decision,
    issues,
    episodeCount: episodes.length,
    procedureCount: procedures.length,
    familyCount,
    weAreNot: [
      'SkillGLoW',
      'GLoW weave optimizer',
      'ALFWorld skill trainer',
      'per-task episode memory product',
    ],
    claimBoundary: decision === 'deny'
      ? 'Library is generic, instance-bound, inflating, or committing without a measured execution gate. Local ThumbGate doctor, not SkillGLoW.'
      : 'Procedural families are compact and de-instantiated on this local doctor. Not SkillGLoW, not a 17.2-point claim.',
  };
}

function item(id, status, detail) {
  return { id, status, detail };
}

function surfaceExists(root, rel) {
  return fs.existsSync(path.join(root, rel));
}

function evaluateCheckout(input = {}) {
  const root = path.resolve(input.root || DEFAULT_ROOT);
  const claimLive = input.claimLive === true;
  const items = [];

  const procedureSurface = surfaceExists(root, SURFACES.feedbackToRules);
  items.push(item(
    'procedure_promotion',
    procedureSurface ? 'pass' : 'fail',
    procedureSurface
      ? 'Mapped to scripts/feedback-to-rules.js (reusable procedures, not every episode).'
      : 'feedback-to-rules.js missing',
  ));

  const canonical = surfaceExists(root, SURFACES.lessonCanonical);
  items.push(item(
    'deinstantiate_wording',
    canonical ? 'pass' : 'fail',
    canonical
      ? 'Mapped to scripts/lesson-canonical.js. Instance detail should be rebuilt per task, not stored as a twin lesson.'
      : 'lesson-canonical.js missing',
  ));

  const memorySplit = surfaceExists(root, SURFACES.memoryVsRag)
    && surfaceExists(root, SURFACES.memoryFirewall);
  items.push(item(
    'memory_not_transcript_pool',
    memorySplit ? 'pass' : 'fail',
    memorySplit
      ? 'Mapped to memory-vs-rag + memory-firewall. Transcript dumps are not the library.'
      : 'memory-vs-rag or memory-firewall missing',
  ));

  const progressive = surfaceExists(root, SURFACES.skillProgressive);
  items.push(item(
    'skill_progressive_surface',
    progressive ? 'pass' : 'fail',
    progressive
      ? 'Mapped to skill-progressive-disclosure tests. Not a SkillGLoW local-skill writer.'
      : 'skill-progressive-disclosure tests missing',
  ));

  items.push(item(
    'glow_weave_trainer',
    'not_wired',
    'SkillGLoW Global-Local Weave trainer / ALFWorld eval loop are not implemented.',
  ));
  items.push(item(
    'published_17_point_gain',
    'not_wired',
    '17.2 / 3.6× compactness figures are the paper’s, not ThumbGate measurements.',
  ));

  const liveBlockedReasons = [];
  if (claimLive) {
    liveBlockedReasons.push('claimLive_refused_without_skillglow_runtime');
    for (const row of items.filter((entry) => entry.status === 'not_wired')) {
      liveBlockedReasons.push(`not_wired:${row.id}`);
    }
  }

  const fails = items.filter((row) => row.status === 'fail');
  let decision = 'allow';
  if (claimLive || fails.length > 0) decision = 'deny';

  return {
    schemaVersion: `${SCHEMA_VERSION}.checkout`,
    source: 'https://arxiv.org/abs/2609.02217',
    affiliation: 'none',
    weAreNot: evaluateLibrary().weAreNot,
    root,
    decision,
    livePromotionAllowed: false,
    claimLive,
    liveBlockedReasons,
    items,
    claimBoundary: claimLive
      ? 'Refused: this doctor cannot become SkillGLoW, GLoW, or an ALFWorld skill trainer.'
      : 'Local mapping of procedure-family compactness + execution commit gate. Simulated controls are not SkillGLoW.',
  };
}

function formatText(report) {
  if (report.issues) {
    return `skill-library-compact  decision=${report.decision}  issues=${(report.issues || []).join(',')}\n${report.claimBoundary}\n`;
  }
  const lines = [
    `skill-library-compact  decision=${report.decision}  live=${report.livePromotionAllowed}`,
    `affiliation=${report.affiliation}  not: ${report.weAreNot.join(', ')}`,
  ];
  for (const row of report.items || []) {
    lines.push(`  [${row.status}] ${row.id} — ${row.detail}`);
  }
  lines.push(report.claimBoundary);
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const options = { json: false, root: DEFAULT_ROOT, claimLive: false, decide: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--claim-live') options.claimLive = true;
    else if (arg === '--root') options.root = argv[++i];
    else if (arg.startsWith('--root=')) options.root = arg.slice('--root='.length);
    else if (arg === '--decide') options.decide = argv[++i];
    else if (arg.startsWith('--decide=')) options.decide = arg.slice('--decide='.length);
  }
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  let report;
  if (options.decide) {
    report = evaluateLibrary(JSON.parse(options.decide));
  } else {
    report = evaluateCheckout({ root: options.root, claimLive: options.claimLive });
  }
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatText(report));
  return report.decision === 'deny' ? 2 : 0;
}

module.exports = {
  SCHEMA_VERSION,
  SURFACES,
  evaluateLibrary,
  evaluateCheckout,
  formatText,
  main,
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
