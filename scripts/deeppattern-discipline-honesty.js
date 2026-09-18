#!/usr/bin/env node
'use strict';

/**
 * DeepPattern (AQG + Decision Engine) FORMAT steal — not a clone.
 *
 * Sources (public, MIT, 2026-09):
 *   https://github.com/deeppatternai/agent-quality-gates
 *   https://github.com/deeppatternai/decision-engine
 *
 * Transfers:
 *   1. layer-check — refuse treating products at different stack layers as substitutes
 *      (DE /layer-check). Primary failure: L4 transport/API gateway as "competitor" to
 *      L7 PreToolUse governance; or multi-model panel SaaS as ThumbGate substitute.
 *   2. evidence-closeout — six required evidence items before claiming done
 *      (AQG check_evidence_closeout). Maps onto ThumbGate Completion Claim Contract.
 *
 * Does NOT install AQG, Decision Engine, dp-install, or a cross-vendor audit SKU.
 * Does NOT unpark LLM adjudicator (#3690/#3687). Hosted multi-model panels stay external.
 */

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_AQG = 'https://github.com/deeppatternai/agent-quality-gates';
const SOURCE_DE = 'https://github.com/deeppatternai/decision-engine';

const LAYERS = Object.freeze({
  L1: 'Metal / hardware',
  L2: 'Foundation model',
  L3: 'Training / eval infrastructure',
  L4: 'Transport / API gateway',
  L5: 'Orchestration framework',
  L6: 'Developer tooling platform',
  L7: 'Application / workflow SaaS',
  L8: 'Brand / distribution surface',
});

const THUMBGATE_LAYER = 'L7';

const REQUIRED_CLOSEOUT_ITEMS = Object.freeze([
  'scope completed',
  'verification run',
  'audit adjudicated',
  'durable state updated',
  'production boundary',
  'remaining blockers',
]);

const EMPTY_CLOSEOUT_VALUES = new Set([
  '', '-', '--', 'n/a', 'na', 'todo', 'tbd', 'pending',
]);

const CLONE_RE = /\b(dp-install|agent-quality-gates|decision-engine|aqg_doctor|deeppattern|install_aqg|\/audit-forecast|\/discussion-board)\b/i;
const SUBSTITUTE_RE = /\b(replace[sd]?|substitut\w*|commoditiz\w*|competes? with|instead of|drop thumbgate for|thumbgate is just|same as thumbgate)\b/i;
const CROSS_LAYER_SUBJECTS = [
  { re: /\b(api gateway|token aggregat\w*|openrouter|litellm|multi-?vendor (api|token)|raw (model )?api)\b/i, layer: 'L4', label: 'transport / API gateway' },
  { re: /\b(langchain|langgraph|crewai|autogen|agent framework|orchestration framework)\b/i, layer: 'L5', label: 'orchestration framework' },
  { re: /\b(foundation model|gpt-5|claude-4|raw llm|base model family)\b/i, layer: 'L2', label: 'foundation model' },
  { re: /\b(decision engine|cross-vendor panel|multi-?model (panel|audit)|hosted audit engine)\b/i, layer: 'L7_adjacent', label: 'hosted multi-model panel (complement, not PreToolUse gate)' },
];

const RAIL_MAP = Object.freeze([
  {
    deeppattern: 'layer-check: same job-to-be-done before calling something a substitute',
    thumbgate: 'PreToolUse evaluate→block→evidence is L7 governance; L4 gateways are inputs',
  },
  {
    deeppattern: 'AQG evidence-closeout: six required items before "done"',
    thumbgate: 'Completion Claim Contract — merge SHA / /health.buildSha / terminal CI',
  },
  {
    deeppattern: 'AQG local discipline + DE hosted panel as a pair',
    thumbgate: 'Deterministic gates stay local; hosted multi-model audit is optional external',
  },
  {
    deeppattern: 'Never invent forecast numbers; pool existing sources',
    thumbgate: 'Never invent ROI; never claim LIVE without same-session evidence',
  },
]);

function normalizeBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function normalizeLabel(value) {
  return String(value || '')
    .trim()
    .replace(/[*_`|]/g, '')
    .replace(/[^a-z0-9 \-/]/gi, ' ')
    .replace(/[/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isPlaceholder(value) {
  const stripped = String(value || '').trim();
  const lowered = stripped.toLowerCase();
  const normalized = normalizeLabel(stripped);
  if (EMPTY_CLOSEOUT_VALUES.has(normalized)) return true;
  if (/\b(todo|tbd)\b/.test(lowered)) return true;
  if (/__fill/.test(lowered)) return true;
  if (/<[^>]+>/.test(stripped)) return true;
  const compact = lowered.replace(/[^a-z0-9]/g, '');
  return compact.length > 0 && compact.length < 3;
}

function headingSpans(text) {
  const pattern = /^(#{1,6})\s+(.+?)\s*$/gm;
  const matches = [...String(text || '').matchAll(pattern)];
  const spans = [];
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const start = match.index + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    spans.push({ title: match[2].trim(), body: text.slice(start, end) });
  }
  return spans;
}

function isEvidenceHeading(title) {
  const normalized = normalizeLabel(title);
  return normalized.includes('evidence') || normalized.includes('closeout') || title.includes('证据');
}

function extractCloseoutItems(text) {
  const blocks = headingSpans(text)
    .filter((span) => isEvidenceHeading(span.title))
    .map((span) => span.body);
  if (!blocks.length && REQUIRED_CLOSEOUT_ITEMS.some((item) => normalizeLabel(text).includes(item))) {
    blocks.push(text);
  }

  const found = {};
  for (const block of blocks) {
    for (const line of block.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        const cells = trimmed.slice(1, -1).split('|').map((c) => c.trim());
        if (cells.length < 2) continue;
        if (cells.every((c) => /^[-:\s]+$/.test(c))) continue;
        const label = normalizeLabel(cells[0]);
        if (REQUIRED_CLOSEOUT_ITEMS.includes(label)) {
          found[label] = cells.slice(1).join(' | ').trim();
        }
        continue;
      }
      const colon = /^(?:\*\*)?([^:*|]{3,80}?)(?:\*\*)?\s*:\s*(.+)$/.exec(
        trimmed.replace(/^[-*]\s+/, '')
      );
      if (!colon) continue;
      const label = normalizeLabel(colon[1]);
      if (REQUIRED_CLOSEOUT_ITEMS.includes(label)) {
        found[label] = colon[2].trim();
      }
    }
  }
  return {
    hasHeading: headingSpans(text).some((span) => isEvidenceHeading(span.title)),
    found,
  };
}

function normalizeOptions(raw = {}) {
  return {
    claim: String(raw.claim || ''),
    subjectLayer: String(raw['subject-layer'] || raw.subjectLayer || THUMBGATE_LAYER).toUpperCase(),
    closeoutPath: raw.closeout || raw['closeout-path'] || raw.closeoutPath || null,
    closeoutText: raw['closeout-text'] || raw.closeoutText || null,
    mapOnly: normalizeBoolean(raw['map-only'] || raw.mapOnly),
    claimReady: normalizeBoolean(raw['claim-ready'] || raw.claimReady),
    cloneDeeppattern: normalizeBoolean(raw['clone-deeppattern'] || raw.cloneDeeppattern || raw['clone-aqg'] || raw.cloneAqg),
    json: normalizeBoolean(raw.json),
    strict: normalizeBoolean(raw.strict),
  };
}

function buildDeeppatternDisciplineHonestyReport(rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  const findings = [];
  const claim = options.claim;

  if (options.cloneDeeppattern || CLONE_RE.test(claim)) {
    findings.push({
      id: 'deeppattern_sku_clone',
      severity: 'fail',
      gateId: 'refuse-deeppattern-sku-clone',
      message: 'Refused cloning Agent Quality Gates / Decision Engine / dp-install as a ThumbGate SKU. Steal FORMAT only.',
    });
  }

  if (claim && SUBSTITUTE_RE.test(claim)) {
    for (const subject of CROSS_LAYER_SUBJECTS) {
      if (!subject.re.test(claim)) continue;
      const distanceNote = subject.layer === 'L7_adjacent'
        ? 'same-layer complement (hosted panel) ≠ PreToolUse evaluate→block→evidence substitute'
        : `layer ${subject.layer} vs ThumbGate ${THUMBGATE_LAYER}`;
      findings.push({
        id: 'cross_layer_substitute',
        severity: 'fail',
        gateId: 'require-same-layer-comparison',
        message: `Category error: treating ${subject.label} as a ThumbGate substitute (${distanceNote}). Tag layers; compare only same job-to-be-done.`,
        subjectLayer: options.subjectLayer,
        referenceLayer: subject.layer,
      });
    }
  }

  // Explicit layer distance check when claim names a lower-layer product next to ThumbGate/governance
  if (claim && /\b(thumbgate|pretooluse|prevention rule|evaluate.?block.?evidence)\b/i.test(claim)) {
    for (const subject of CROSS_LAYER_SUBJECTS) {
      if (subject.layer === 'L7_adjacent') continue;
      if (!subject.re.test(claim)) continue;
      if (findings.some((f) => f.id === 'cross_layer_substitute' && f.referenceLayer === subject.layer)) {
        continue;
      }
      if (/\b(input|dependenc|consumes?|routes? through|sits under|below)\b/i.test(claim)) {
        continue; // honest dependency language is fine
      }
      if (/\b(compet\w*|substitut\w*|commoditiz\w*|replace[sd]?|instead of|vs\.?|versus)\b/i.test(claim)) {
        findings.push({
          id: 'cross_layer_substitute',
          severity: 'fail',
          gateId: 'require-same-layer-comparison',
          message: `Cross-layer comparison: ${subject.label} (${subject.layer}) vs ThumbGate (${THUMBGATE_LAYER}). Use as dependency language, not competitor language.`,
          subjectLayer: THUMBGATE_LAYER,
          referenceLayer: subject.layer,
        });
      }
    }
  }

  let closeout = null;
  const closeoutSource = options.closeoutText
    || (options.closeoutPath ? fs.readFileSync(String(options.closeoutPath), 'utf8') : null);
  if (closeoutSource != null) {
    const extracted = extractCloseoutItems(closeoutSource);
    closeout = {
      hasHeading: extracted.hasHeading,
      items: extracted.found,
      missing: [],
      placeholders: [],
    };
    if (!extracted.hasHeading) {
      findings.push({
        id: 'missing_evidence_heading',
        severity: 'fail',
        gateId: 'require-evidence-closeout-items',
        message: 'Closeout markdown needs an ## Evidence / Closeout heading (AQG evidence-closeout FORMAT).',
      });
    }
    for (const item of REQUIRED_CLOSEOUT_ITEMS) {
      if (!(item in extracted.found)) {
        closeout.missing.push(item);
        findings.push({
          id: 'missing_closeout_item',
          severity: 'fail',
          gateId: 'require-evidence-closeout-items',
          message: `Missing evidence closeout item: ${item}`,
          item,
        });
      } else if (isPlaceholder(extracted.found[item])) {
        closeout.placeholders.push(item);
        findings.push({
          id: 'placeholder_closeout_item',
          severity: 'fail',
          gateId: 'require-evidence-closeout-items',
          message: `Evidence closeout item has placeholder value: ${item}`,
          item,
        });
      }
    }
  }

  if (options.claimReady && findings.length) {
    findings.push({
      id: 'claim_ready_blocked',
      severity: 'fail',
      gateId: 'require-same-layer-comparison',
      message: '--claim-ready refused: clear layer-check and closeout findings first.',
    });
  }

  const failCount = findings.filter((f) => f.severity === 'fail').length;
  const status = options.mapOnly && !failCount
    ? 'ready'
    : (failCount ? 'fail' : 'ready');

  const nextActions = [];
  if (findings.some((f) => f.id === 'deeppattern_sku_clone')) {
    nextActions.push('Keep AQG/DE as neighbors. Steal layer-check + evidence-closeout FORMAT only.');
  }
  if (findings.some((f) => f.id === 'cross_layer_substitute')) {
    nextActions.push('Retag each product L1–L8; drop cross-layer substitutes; cite specific surfaces not company names.');
  }
  if (findings.some((f) => f.gateId === 'require-evidence-closeout-items')) {
    nextActions.push('Add an Evidence/Closeout heading with all six required items filled from fresh checks.');
  }
  if (!nextActions.length) {
    nextActions.push('Use --map-only for the rail map; pass --closeout=path.md before claiming done.');
  }

  return {
    name: 'thumbgate-deeppattern-discipline-honesty',
    ok: status === 'ready',
    status,
    source: { aqg: SOURCE_AQG, decisionEngine: SOURCE_DE },
    thumbgateLayer: THUMBGATE_LAYER,
    layers: LAYERS,
    requiredCloseoutItems: REQUIRED_CLOSEOUT_ITEMS,
    map: options.mapOnly || !findings.length ? RAIL_MAP : undefined,
    closeout,
    findings,
    summary: {
      findingCount: findings.length,
      failCount,
    },
    nextActions,
    exampleCommand: 'npx thumbgate deeppattern-discipline-honesty --json --map-only',
    disclaimer: 'FORMAT steal from DeepPattern Agent Quality Gates + Decision Engine. Not affiliated. Does not install AQG/DE or ship a cross-vendor audit SKU.',
  };
}

function formatDeeppatternDisciplineHonestyReport(report) {
  const lines = [
    'DeepPattern Discipline Honesty Doctor',
    `Status  : ${report.status}`,
    `Layer   : ThumbGate ${report.thumbgateLayer} (application / workflow governance)`,
    `Sources : ${report.source.aqg}`,
    `         ${report.source.decisionEngine}`,
    `Findings: ${report.summary.findingCount} (fail=${report.summary.failCount})`,
  ];
  if (report.map) {
    lines.push('', 'Rail map:');
    for (const row of report.map) {
      lines.push(`  - ${row.deeppattern}`);
      lines.push(`    → ${row.thumbgate}`);
    }
  }
  if (report.closeout) {
    lines.push('', 'Closeout:');
    lines.push(`  heading: ${report.closeout.hasHeading ? 'yes' : 'no'}`);
    lines.push(`  missing: ${report.closeout.missing.join(', ') || 'none'}`);
    lines.push(`  placeholders: ${report.closeout.placeholders.join(', ') || 'none'}`);
  }
  if (report.findings.length) {
    lines.push('', 'Findings:');
    for (const f of report.findings) {
      lines.push(`  - [${f.severity}] ${f.id}${f.gateId ? ` [${f.gateId}]` : ''}`);
      lines.push(`    ${f.message}`);
    }
  }
  lines.push('', 'Next actions:');
  for (const a of report.nextActions) lines.push(`  - ${a}`);
  lines.push('', `Example: ${report.exampleCommand}`);
  lines.push(`Note: ${report.disclaimer}`, '');
  return `${lines.join('\n')}\n`;
}

function parseCliArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (arg === '--json') { options.json = true; continue; }
    if (arg === '--strict') { options.strict = true; continue; }
    if (arg === '--map-only') { options['map-only'] = true; continue; }
    if (arg === '--claim-ready') { options['claim-ready'] = true; continue; }
    if (arg === '--clone-deeppattern' || arg === '--clone-aqg') {
      options['clone-deeppattern'] = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!m) continue;
    options[m[1]] = m[2] === undefined ? true : m[2];
  }
  return options;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/deeppattern-discipline-honesty.js [flags]

Flags:
  --claim=TEXT             Comparative / substitute claim to layer-check
  --subject-layer=L7       Subject product layer (default L7)
  --closeout=PATH          Markdown closeout / PR body to validate
  --closeout-text=TEXT     Inline closeout markdown
  --map-only
  --claim-ready
  --clone-deeppattern      Always fail (refuse AQG/DE SKU clone)
  --json --strict

Sources:
  ${SOURCE_AQG}
  ${SOURCE_DE}
`);
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  const report = buildDeeppatternDisciplineHonestyReport(args);
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatDeeppatternDisciplineHonestyReport(report));
  if (args.strict && report.status !== 'ready') return 1;
  if (report.status === 'fail') return 1;
  return 0;
}

module.exports = {
  SOURCE_AQG,
  SOURCE_DE,
  LAYERS,
  THUMBGATE_LAYER,
  REQUIRED_CLOSEOUT_ITEMS,
  RAIL_MAP,
  buildDeeppatternDisciplineHonestyReport,
  formatDeeppatternDisciplineHonestyReport,
  extractCloseoutItems,
  runCli,
};

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  process.exitCode = runCli();
}
