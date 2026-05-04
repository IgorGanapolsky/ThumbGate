'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildUTMLink } = require('./social-analytics/utm');
const { ensureDir } = require('./fs-utils');

function normalizeText(value) {
  return String(value ?? '').trim();
}

function csvCell(value) {
  const text = normalizeText(value);
  if (!/[",\n]/.test(text)) {
    return text;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

function readGitHubAbout(repoRoot = path.resolve(__dirname, '..')) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, 'config', 'github-about.json'), 'utf8'));
}

function parseReportArgs(argv = []) {
  const options = {
    reportDir: '',
    writeDocs: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--write-docs') {
      options.writeDocs = true;
      continue;
    }
    if (arg === '--report-dir') {
      options.reportDir = normalizeText(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--report-dir=')) {
      options.reportDir = normalizeText(arg.split(/=(.*)/s)[1]);
    }
  }

  return options;
}

function buildTrackedPackLink(baseUrl, tracking = {}, defaults = {}) {
  const url = new URL(buildUTMLink(baseUrl, {
    source: tracking.utmSource || defaults.utmSource || '',
    medium: tracking.utmMedium || defaults.utmMedium || '',
    campaign: tracking.utmCampaign || defaults.utmCampaign || '',
    content: tracking.utmContent || defaults.utmContent || '',
  }));
  const extras = {
    campaign_variant: tracking.campaignVariant,
    offer_code: tracking.offerCode,
    cta_id: tracking.ctaId,
    cta_placement: tracking.ctaPlacement,
    plan_id: tracking.planId,
    surface: tracking.surface || defaults.surface || '',
  };

  for (const [key, value] of Object.entries(extras)) {
    const normalized = normalizeText(value);
    if (normalized) {
      url.searchParams.set(key, normalized);
    }
  }

  return url.toString();
}

function renderOperatorQueueCsv(operatorQueue = []) {
  const queue = Array.isArray(operatorQueue) ? operatorQueue : [];
  const rows = [
    ['key', 'audience', 'evidence', 'proofTrigger', 'proofAsset', 'nextAsk', 'recommendedMotion'],
    ...queue.map((entry) => ([
      entry.key,
      entry.audience,
      entry.evidence,
      entry.proofTrigger,
      entry.proofAsset,
      entry.nextAsk,
      entry.recommendedMotion,
    ])),
  ];

  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function renderFieldLines(fields = [], source = {}) {
  return fields.flatMap(({ label, key, value, fallback }) => {
    const resolved = value === undefined ? source?.[key] : value;
    const normalized = normalizeText(resolved);
    if (!normalized && fallback === undefined) {
      return [];
    }
    return [`- ${label}: ${normalized || fallback}`];
  });
}

function renderSurfaceLines(surfaces = [], surfaceFields = []) {
  if (!Array.isArray(surfaces) || !surfaces.length) {
    return ['- No evidence surfaces available.', ''];
  }

  return surfaces.flatMap((surface) => ([
    `### ${normalizeText(surface.name) || 'Unnamed surface'}`,
    ...renderFieldLines(surfaceFields, surface),
    '',
  ]));
}

function renderQueueLines(operatorQueue = []) {
  if (!Array.isArray(operatorQueue) || !operatorQueue.length) {
    return ['- No operator queue entries available.', ''];
  }

  return operatorQueue.flatMap((entry) => ([
    `### ${entry.audience}`,
    `- Evidence: ${entry.evidence}`,
    `- Proof trigger: ${entry.proofTrigger}`,
    `- Proof asset: ${entry.proofAsset}`,
    `- Next ask: ${entry.nextAsk}`,
    `- Recommended motion: ${entry.recommendedMotion}`,
    '',
  ]));
}

function renderDraftLines(outreachDrafts = []) {
  if (!Array.isArray(outreachDrafts) || !outreachDrafts.length) {
    return ['- No outreach drafts available.', ''];
  }

  return outreachDrafts.flatMap((draft) => ([
    `### ${draft.channel} — ${draft.audience}`,
    draft.draft,
    '',
  ]));
}

function renderOfferLines(followOnOffers = []) {
  if (!Array.isArray(followOnOffers) || !followOnOffers.length) {
    return ['- No follow-on offers available.'];
  }

  return followOnOffers.map((offer) => `- ${offer.label}: ${offer.pricing}\n  Buyer: ${offer.buyer}\n  CTA: ${offer.cta}`);
}

function renderListLines(emptyLine, values = []) {
  if (!Array.isArray(values) || !values.length) {
    return [emptyLine];
  }
  return values.map((value) => `- ${value}`);
}

function renderRevenuePackMarkdown({
  title,
  disclaimer,
  pack = {},
  canonicalFields = [],
  surfaceFields = [],
} = {}) {
  const milestoneLines = Array.isArray(pack.measurementPlan?.milestones) && pack.measurementPlan.milestones.length
    ? pack.measurementPlan.milestones.map((milestone) => `- ${milestone.window}: ${milestone.goal} Decision rule: ${milestone.decisionRule}`)
    : ['- No milestones available.'];

  return [
    `# ${title}`,
    '',
    `Updated: ${pack.generatedAt}`,
    '',
    disclaimer,
    '',
    '## Objective',
    pack.objective,
    '',
    '## Positioning',
    `- State: ${pack.state}`,
    `- Headline: ${pack.headline}`,
    `- Short description: ${pack.shortDescription}`,
    `- Summary: ${pack.summary}`,
    '',
    '## Canonical Identity',
    ...renderFieldLines(canonicalFields, pack.canonicalIdentity),
    '',
    '## Demand Surfaces',
    ...renderSurfaceLines(pack.surfaces, surfaceFields),
    '## Follow-On Offers',
    ...renderOfferLines(pack.followOnOffers),
    '',
    '## Operator Queue',
    ...renderQueueLines(pack.operatorQueue),
    '## Outreach Drafts',
    ...renderDraftLines(pack.outreachDrafts),
    '## 90-Day Measurement Plan',
    `- North star: ${pack.measurementPlan?.northStar || 'n/a'}`,
    `- Policy: ${pack.measurementPlan?.policy || 'n/a'}`,
    `- Minimum useful signal: ${pack.measurementPlan?.minimumUsefulSignal || 'n/a'}`,
    `- Strong signal: ${pack.measurementPlan?.strongSignal || 'n/a'}`,
    'Tracked metrics:',
    ...renderListLines('- n/a', pack.measurementPlan?.metrics),
    'Guardrails:',
    ...renderListLines('- n/a', pack.measurementPlan?.guardrails),
    'Milestones:',
    ...milestoneLines,
    'Do not count as success:',
    ...renderListLines('- n/a', pack.measurementPlan?.doNotCountAsSuccess),
    '',
    '## Proof Links',
    ...renderListLines('- No proof links available.', pack.proofLinks),
    '',
  ].join('\n');
}

function writeStandardRevenuePack({
  repoRoot = path.resolve(__dirname, '..'),
  docsPath,
  pack,
  options = {},
  renderMarkdown,
  jsonName,
  csvName,
} = {}) {
  return writeRevenuePackArtifacts({
    repoRoot,
    reportDir: options.reportDir,
    writeDocs: options.writeDocs,
    docsPath,
    markdown: renderMarkdown(pack),
    jsonName,
    jsonValue: pack,
    csvArtifacts: [
      {
        name: csvName,
        value: renderOperatorQueueCsv(pack?.operatorQueue),
      },
    ],
  });
}

function writeRevenuePackArtifacts({
  repoRoot = path.resolve(__dirname, '..'),
  reportDir = '',
  writeDocs = false,
  docsPath,
  markdown,
  jsonName,
  jsonValue,
  csvName,
  csvValue,
  csvArtifacts,
  extraFiles,
} = {}) {
  const resolvedReportDir = normalizeText(reportDir)
    ? path.resolve(repoRoot, reportDir)
    : '';
  const artifacts = Array.isArray(csvArtifacts) && csvArtifacts.length
    ? csvArtifacts
    : (csvName
      ? [{ name: csvName, value: csvValue }]
      : []);
  const sidecarFiles = Array.isArray(extraFiles) ? extraFiles : [];
  const docsDir = docsPath ? path.dirname(docsPath) : '';

  if (resolvedReportDir) {
    ensureDir(resolvedReportDir);
    fs.writeFileSync(path.join(resolvedReportDir, path.basename(docsPath)), markdown, 'utf8');
    if (jsonName) {
      fs.writeFileSync(path.join(resolvedReportDir, jsonName), `${JSON.stringify(jsonValue, null, 2)}\n`, 'utf8');
    }
    for (const artifact of artifacts) {
      const name = normalizeText(artifact?.name);
      if (!name) {
        continue;
      }
      fs.writeFileSync(path.join(resolvedReportDir, name), normalizeText(artifact?.value) ? artifact.value : '', 'utf8');
    }
    for (const artifact of sidecarFiles) {
      const name = normalizeText(artifact?.name);
      if (!name) {
        continue;
      }
      fs.writeFileSync(path.join(resolvedReportDir, name), normalizeText(artifact?.value) ? artifact.value : '', 'utf8');
    }
  }

  if (writeDocs) {
    if (docsDir) {
      ensureDir(docsDir);
    }
    fs.writeFileSync(docsPath, markdown, 'utf8');
    if (docsDir) {
      if (jsonName) {
        fs.writeFileSync(path.join(docsDir, jsonName), `${JSON.stringify(jsonValue, null, 2)}\n`, 'utf8');
      }
      for (const artifact of artifacts) {
        const name = normalizeText(artifact?.name);
        if (!name) {
          continue;
        }
        fs.writeFileSync(path.join(docsDir, name), normalizeText(artifact?.value) ? artifact.value : '', 'utf8');
      }
      for (const artifact of sidecarFiles) {
        const name = normalizeText(artifact?.name);
        if (!name) {
          continue;
        }
        fs.writeFileSync(path.join(docsDir, name), normalizeText(artifact?.value) ? artifact.value : '', 'utf8');
      }
    }
  }

  return {
    docsPath: writeDocs ? docsPath : null,
    markdown,
    reportDir: resolvedReportDir || null,
  };
}

function isCliInvocation(argv = process.argv, filename) {
  return Boolean(argv[1] && filename && path.resolve(argv[1]) === path.resolve(filename));
}

module.exports = {
  buildTrackedPackLink,
  csvCell,
  isCliInvocation,
  normalizeText,
  parseReportArgs,
  readGitHubAbout,
  renderOperatorQueueCsv,
  renderRevenuePackMarkdown,
  writeRevenuePackArtifacts,
  writeStandardRevenuePack,
};
