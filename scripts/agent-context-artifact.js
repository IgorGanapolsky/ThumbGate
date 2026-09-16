#!/usr/bin/env node
'use strict';

/**
 * Wisdom.ai / Soham Mazumdar FORMAT steal — not a product clone.
 *
 * Sources:
 *   https://www.wisdom.ai/
 *   https://music.youtube.com/watch?v=lRuI0imju0Y
 *     "What Context Really Means in Data Engineering and AI"
 *
 * Transfers:
 *   1. Context is a reusable *agent* artifact (not tribal metadata)
 *   2. Required fields: goal, constraints, sources, freshness, verifier
 *   3. consumer must be `agent` (not human-analyst warehousing)
 *   4. Explicit wrong-fit gate (must include wisdom_ai)
 *
 * Does NOT clone Adaptive Context Engine, Palantir Foundry, or Snowflake OSI.
 * Complements six-block skill packs and ContextFS — does not replace them.
 */

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_URLS = Object.freeze([
  'https://www.wisdom.ai/',
  'https://music.youtube.com/watch?v=lRuI0imju0Y',
]);

const REQUIRED_FIELDS = Object.freeze(['goal', 'constraints', 'sources', 'freshness', 'verifier']);
const REQUIRED_WRONG_FIT = 'wisdom_ai';

const CLONE_PATTERNS = Object.freeze([
  { id: 'ace_sku', re: /\b(clone|install|vendor)\b.{0,50}\b(adaptive context engine|wisdom\.?ai ace)\b/i },
  { id: 'foundry_sku', re: /\b(clone|install|vendor)\b.{0,40}\b(palantir )?foundry\b/i },
  { id: 'osi_sku', re: /\b(clone|implement)\b.{0,40}\b(open semantic interchange|snowflake osi)\b/i },
]);

function normalizeBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function detectCloneAttempt(text) {
  return CLONE_PATTERNS.filter((p) => p.re.test(String(text || ''))).map((p) => p.id);
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  return [value];
}

function resolveTrustedNow(options = {}) {
  if (options.now != null && options.now !== '') {
    const parsed = typeof options.now === 'number' ? options.now : Date.parse(String(options.now));
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function lintPack(pack = {}, options = {}) {
  const findings = [];
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) {
    return [{
      severity: 'fail',
      id: 'empty_pack',
      message: 'Pack is missing. An agent-context artifact is a JSON object, not tribal knowledge.',
    }];
  }

  const consumer = String(pack.consumer || '').toLowerCase();
  if (consumer !== 'agent') {
    findings.push({
      severity: 'fail',
      id: 'consumer_not_agent',
      message: `consumer must be "agent" (got ${pack.consumer || '(missing)'}). Human-analyst warehousing is the old bar.`,
    });
  }

  for (const field of REQUIRED_FIELDS) {
    const v = pack[field];
    const empty = v == null
      || (typeof v === 'string' && !v.trim())
      || (Array.isArray(v) && v.length === 0)
      || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
    if (empty) {
      findings.push({
        severity: 'fail',
        id: `missing_${field}`,
        message: `Agent artifact missing ${field}. Context-as-product requires goal, constraints, sources, freshness, verifier.`,
      });
    }
  }

  const sources = asList(pack.sources);
  for (const src of sources) {
    if (src && typeof src === 'object' && !src.id && !src.path && !src.url) {
      findings.push({
        severity: 'fail',
        id: 'source_unidentified',
        message: 'Each source needs id, path, or url so agents can cite it.',
      });
    }
  }

  const freshness = pack.freshness && typeof pack.freshness === 'object' ? pack.freshness : {};
  const maxAgeHours = Number(freshness.maxAgeHours);
  const asOf = freshness.asOf ? Date.parse(String(freshness.asOf)) : NaN;
  // Pack-supplied freshness.now is not a clock. A stale pack could set now=asOf
  // and certify ready. CLI uses Date.now(); tests may pass options.now / --now=.
  const now = resolveTrustedNow(options);
  if (Number.isFinite(maxAgeHours) && Number.isFinite(asOf)) {
    const ageHours = (now - asOf) / 3600000;
    if (ageHours > maxAgeHours) {
      findings.push({
        severity: 'fail',
        id: 'stale_context',
        message: `Context asOf is ${ageHours.toFixed(1)}h old; maxAgeHours=${maxAgeHours}. Agents must not consume stale packs.`,
      });
    }
  } else if (pack.freshness && !Number.isFinite(maxAgeHours) && !Number.isFinite(asOf)) {
    findings.push({
      severity: 'fail',
      id: 'freshness_unmeasurable',
      message: 'freshness needs maxAgeHours and asOf (ISO) so staleness is checkable.',
    });
  }

  const verifier = pack.verifier && typeof pack.verifier === 'object' ? pack.verifier : {};
  if (pack.verifier && !verifier.command && !verifier.check) {
    findings.push({
      severity: 'fail',
      id: 'verifier_unrunnable',
      message: 'verifier needs command or check. A prose "looks good" is not an agent verifier.',
    });
  }

  const wrongFit = asList(pack.wrongFit || pack.wrong_fit).map((v) => String(v).toLowerCase());
  if (!wrongFit.includes(REQUIRED_WRONG_FIT)) {
    findings.push({
      severity: 'fail',
      id: 'missing_wrong_fit_wisdom_ai',
      message: 'wrongFit must include "wisdom_ai". The episode\'s wrong-fit question is the buy-vs-build gate — ACE is not our SKU.',
    });
  }

  return findings;
}

function loadPack(filePath) {
  if (!filePath) return null;
  if (typeof filePath === 'object') return filePath;
  return JSON.parse(fs.readFileSync(String(filePath), 'utf8'));
}

function collectHaystack(options = {}) {
  const parts = [
    options.task,
    options.query,
    options['clone-ace'] ? 'clone Adaptive Context Engine vendor Palantir Foundry implement Snowflake OSI' : '',
  ];
  if (Array.isArray(options.argv)) parts.push(...options.argv);
  return parts.filter(Boolean).join(' ');
}

function buildAgentContextArtifactReport(options = {}) {
  const findings = [];
  const cloneHits = [...new Set(detectCloneAttempt(collectHaystack(options)))];
  if (cloneHits.length) {
    findings.push({
      severity: 'fail',
      id: 'wisdom_clone_refused',
      message: `Refusing ACE / Foundry / OSI clones (${cloneHits.join(', ')}). Lint a local agent pack; do not buy a semantic-layer SKU.`,
    });
  }

  const mapOnly = normalizeBoolean(options.map || options['map-only']);
  let pack = null;
  if (!mapOnly) {
    if (options.pack && typeof options.pack === 'object' && !Array.isArray(options.pack)) {
      pack = options.pack;
    } else if (options.pack) {
      pack = loadPack(options.pack);
    }
    if (pack) findings.push(...lintPack(pack, { now: options.now }));
    else if (!cloneHits.length) {
      findings.push({
        severity: 'warn',
        id: 'no_pack',
        message: 'No --pack JSON. Pass an agent-context artifact to lint. Complements six-block SKILL.md packs + ContextFS.',
      });
    }
  }

  let status = 'ready';
  if (findings.some((f) => f.severity === 'fail')) status = 'fail';
  else if (findings.some((f) => f.severity === 'warn')) status = 'ready_with_warnings';

  return {
    name: 'thumbgate-agent-context-artifact',
    status,
    ok: status !== 'fail',
    requiredFields: REQUIRED_FIELDS,
    requiredWrongFit: REQUIRED_WRONG_FIT,
    pack: mapOnly ? null : pack,
    compareNotClone: true,
    complements: [
      'six-block SKILL.md packs (goal/constraints/reference/examples/procedures/rubric)',
      'ContextFS envelopes',
      'memory-vs-rag-route (stateful lessons vs stateless RAG)',
    ],
    never: [
      'clone Wisdom Adaptive Context Engine',
      'clone Palantir Foundry or Snowflake OSI',
      'treat catalogs/query logs as afterthought metadata',
      'ship a pack with consumer=human',
      'omit wisdom_ai from wrongFit',
    ],
    source: SOURCE_URLS,
    disclaimer: 'FORMAT steal only. Not affiliated with Wisdom.ai, Palantir, or Snowflake. Local agent packs; no ACE SKU.',
    findings,
  };
}

function formatAgentContextArtifactReport(report) {
  const lines = [
    'ThumbGate agent-context artifact (Wisdom.ai FORMAT steal)',
    `Status   : ${report.status}`,
    `ok       : ${report.ok}`,
    `Fields   : ${(report.requiredFields || []).join(', ')}`,
    `wrongFit : must include ${report.requiredWrongFit}`,
  ];
  if (report.findings?.length) {
    lines.push('Findings:');
    for (const f of report.findings) lines.push(`  [${f.severity}] ${f.id}: ${f.message}`);
  }
  lines.push(`Never    : ${(report.never || []).join('; ')}`);
  lines.push(`Source   : ${(report.source || []).join(' · ')}`);
  lines.push(report.disclaimer);
  return `${lines.join('\n')}\n`;
}

function parseArgv(argv) {
  const options = { argv };
  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--map-only' || arg === '--map') options.map = true;
    else if (arg === '--clone-ace') options['clone-ace'] = true;
    else if (arg.startsWith('--pack=')) options.pack = arg.slice('--pack='.length);
    else if (arg.startsWith('--now=')) options.now = arg.slice('--now='.length);
  }
  return options;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/agent-context-artifact.js [options]

Wisdom.ai FORMAT: context as a reusable *agent* artifact
(goal, constraints, sources, freshness, verifier) + wrong-fit.
Does not clone ACE / Foundry / OSI.

Options:
  --pack=<file.json>
  --now=<ISO>     Trusted clock (tests). Pack freshness.now is ignored.
  --map-only
  --clone-ace     Fail closed
  --json --strict
`);
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return 0;
  }
  const options = parseArgv(argv);
  const report = buildAgentContextArtifactReport(options);
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatAgentContextArtifactReport(report));
  if (options.strict && report.status !== 'ready') return 1;
  if (report.status === 'fail') return 1;
  return 0;
}

module.exports = {
  REQUIRED_FIELDS,
  REQUIRED_WRONG_FIT,
  SOURCE_URLS,
  detectCloneAttempt,
  resolveTrustedNow,
  lintPack,
  buildAgentContextArtifactReport,
  formatAgentContextArtifactReport,
  main,
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  process.exitCode = main();
}
