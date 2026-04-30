#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { buildUTMLink } = require('./social-analytics/utm');
const {
  COMMERCIAL_TRUTH_LINK,
  VERIFICATION_EVIDENCE_LINK,
  buildRevenueLinks,
} = require('./gtm-revenue-loop');
const {
  getCodexPluginLatestDownloadUrl,
  getCodexPluginVersionedDownloadUrl,
} = require('./distribution-surfaces');
const {
  csvCell,
  isCliInvocation: isCliCall,
  normalizeText,
  parseReportArgs,
  readGitHubAbout,
  writeRevenuePackArtifacts,
} = require('./revenue-pack-utils');

const REPO_ROOT = path.resolve(__dirname, '..');
const CODEX_SOURCE = 'codex';
const CODEX_SURFACE = 'codex_plugin';
const CODEX_MEDIUM = 'plugin_page';
const CANONICAL_SHORT_DESCRIPTION = 'Auto-updating ThumbGate plugin for Codex. Capture thumbs-up/down feedback, turn repeated failures into Pre-Action Checks, and keep proof close to the install path.';
const CANONICAL_HEADLINE = 'Stop Codex from repeating the same tool mistake.';
const CANONICAL_SUBHEAD = 'ThumbGate gives Codex an auto-updating MCP runtime, local-first feedback memory, and hard pre-action gates before risky commands, edits, or publishes run again.';
const INSTALL_DOC_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/plugins/codex-profile/INSTALL.md';
const PROFILE_README_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/plugins/codex-profile/README.md';
const BRIDGE_README_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/plugins/claude-codex-bridge/README.md';
const PROOF_LINKS = [COMMERCIAL_TRUTH_LINK, VERIFICATION_EVIDENCE_LINK];

function buildTrackedCodexLink(baseUrl, tracking = {}) {
  const url = new URL(buildUTMLink(baseUrl, {
    source: tracking.utmSource || CODEX_SOURCE,
    medium: tracking.utmMedium || CODEX_MEDIUM,
    campaign: tracking.utmCampaign || 'codex_plugin',
    content: tracking.utmContent || 'install',
  }));
  const extras = {
    campaign_variant: tracking.campaignVariant,
    offer_code: tracking.offerCode,
    cta_id: tracking.ctaId,
    cta_placement: tracking.ctaPlacement,
    plan_id: tracking.planId,
    surface: tracking.surface || CODEX_SURFACE,
  };

  for (const [key, value] of Object.entries(extras)) {
    const normalized = normalizeText(value);
    if (normalized) {
      url.searchParams.set(key, normalized);
    }
  }

  return url.toString();
}

function buildEvidenceSurfaces(links = buildRevenueLinks(), about = readGitHubAbout(), repoRoot = REPO_ROOT) {
  const surfaces = [
    {
      key: 'install_page',
      name: 'Codex install page',
      url: buildTrackedCodexLink(`${links.appOrigin}/codex-plugin`, {
        utmCampaign: 'codex_plugin_page',
        utmContent: 'install_page',
        campaignVariant: 'install_page',
        offerCode: 'CODEX-INSTALL_PAGE',
        ctaId: 'codex_install_page',
        ctaPlacement: 'install_surface',
      }),
      supportUrl: INSTALL_DOC_URL,
      evidenceSource: 'public/codex-plugin.html',
      operatorUse: 'Primary human-readable install and conversion surface for Codex users.',
      buyerSignal: 'Codex users who want a proof-backed install page before downloading a zip or editing config files.',
    },
    {
      key: 'standalone_bundle',
      name: 'Standalone bundle download',
      url: getCodexPluginLatestDownloadUrl(repoRoot),
      versionedUrl: getCodexPluginVersionedDownloadUrl(repoRoot),
      supportUrl: PROFILE_README_URL,
      evidenceSource: 'plugins/codex-profile/README.md',
      operatorUse: 'Portable plugin path for buyers who want a direct asset instead of a repo checkout.',
      buyerSignal: 'Warm buyers ready to install now if the runtime, update policy, and proof links are explicit.',
    },
    {
      key: 'repo_profile',
      name: 'Repo-local Codex profile docs',
      url: PROFILE_README_URL,
      supportUrl: INSTALL_DOC_URL,
      evidenceSource: 'plugins/codex-profile/README.md',
      operatorUse: 'Technical proof surface for install steps, runtime update policy, and self-contained bundle contents.',
      buyerSignal: 'Technical evaluators comparing the plugin surface versus the manual MCP path.',
    },
    {
      key: 'codex_bridge',
      name: 'Claude Code Codex bridge',
      url: BRIDGE_README_URL,
      supportUrl: BRIDGE_README_URL,
      evidenceSource: 'plugins/claude-codex-bridge/README.md',
      operatorUse: 'Cross-sell surface when a team already trusts Claude Code but wants a Codex review lane.',
      buyerSignal: 'Teams that need second-pass review or adversarial review before broader rollout.',
    },
  ];

  return surfaces.map((surface) => ({
    ...surface,
    proofUrl: VERIFICATION_EVIDENCE_LINK,
    proofLinks: [...PROOF_LINKS],
    repositoryUrl: about.repositoryUrl,
  }));
}

function buildListingCopy(links = buildRevenueLinks()) {
  const followOnOffers = [
    {
      key: 'pro',
      label: 'ThumbGate Pro',
      pricing: links.proPriceLabel,
      buyer: 'Solo Codex operators who proved one blocked repeat and want the personal dashboard plus proof-ready exports.',
      cta: buildTrackedCodexLink(links.proCheckoutLink, {
        utmCampaign: 'codex_plugin_follow_on',
        utmContent: 'pro',
        campaignVariant: 'pro_follow_on',
        offerCode: 'CODEX-PRO_FOLLOW_ON',
        ctaId: 'codex_pro_follow_on',
        ctaPlacement: 'post_install',
        planId: 'pro',
        surface: 'codex_post_install',
      }),
    },
    {
      key: 'sprint',
      label: 'Workflow Hardening Sprint',
      pricing: 'Intake-led sprint, then Team at $49/seat/mo with 3-seat minimum after qualification',
      buyer: 'Teams that already named one repeated workflow failure, one owner, and one approval boundary.',
      cta: buildTrackedCodexLink(links.sprintLink, {
        utmCampaign: 'codex_team_follow_on',
        utmContent: 'workflow_sprint',
        campaignVariant: 'teams_follow_on',
        offerCode: 'CODEX-TEAMS_FOLLOW_ON',
        ctaId: 'codex_team_follow_on',
        ctaPlacement: 'post_install',
        surface: 'codex_post_install',
      }),
    },
  ];

  return {
    headline: CANONICAL_HEADLINE,
    subhead: CANONICAL_SUBHEAD,
    shortDescription: CANONICAL_SHORT_DESCRIPTION,
    proofBullets: [
      'Auto-updating Codex MCP runtime resolves thumbgate@latest on startup.',
      'Typed thumbs-up/down feedback can become durable Pre-Action Checks instead of chat-only reminders.',
      'Commercial Truth and Verification Evidence stay one click from the install path.',
    ],
    primaryCta: {
      label: 'Download Codex plugin',
      url: getCodexPluginLatestDownloadUrl(REPO_ROOT),
    },
    secondaryCta: {
      label: 'Read install docs',
      url: INSTALL_DOC_URL,
    },
    proofCta: {
      label: 'Verification evidence',
      url: VERIFICATION_EVIDENCE_LINK,
    },
    followOnOffers,
  };
}

function buildOperatorQueue(links = buildRevenueLinks()) {
  const queue = [
    {
      key: 'solo_repeat_mistake',
      persona: 'Solo Codex operator with one repeated tool or file-edit mistake',
      evidence: 'README.md promotes npx thumbgate init --agent codex and public/codex-plugin.html keeps the direct plugin path visible.',
      proofTrigger: 'They can name one repeat they would pay to block before the next tool call.',
      proofAsset: VERIFICATION_EVIDENCE_LINK,
      recommendedMotion: 'Install the plugin or run the CLI, prove one blocked repeat, then offer Pro.',
      nextAskBase: `${links.appOrigin}/codex-plugin`,
      tracking: {
        utmCampaign: 'codex_queue_install',
        utmContent: 'plugin_page',
        campaignVariant: 'solo_repeat_mistake',
        offerCode: 'CODEX-QUEUE_INSTALL',
        ctaId: 'codex_queue_install',
        ctaPlacement: 'operator_queue',
      },
    },
    {
      key: 'bridge_team',
      persona: 'Claude Code team that wants a Codex second-pass or adversarial review lane',
      evidence: 'plugins/claude-codex-bridge/README.md already positions Codex as a review surface inside the same ThumbGate memory loop.',
      proofTrigger: 'They already rely on Claude Code and want a Codex review or second-pass workflow without losing local gates.',
      proofAsset: BRIDGE_README_URL,
      recommendedMotion: 'Lead with one workflow, one owner, one proof review and route to the sprint intake.',
      nextAskBase: links.sprintLink,
      tracking: {
        utmCampaign: 'codex_bridge_team_motion',
        utmContent: 'workflow_sprint',
        campaignVariant: 'bridge_team',
        offerCode: 'CODEX-BRIDGE_TEAM',
        ctaId: 'codex_bridge_team',
        ctaPlacement: 'operator_queue',
        surface: 'codex_bridge_queue',
      },
    },
    {
      key: 'repo_backed_rollout',
      persona: 'Team evaluating repo-backed Codex rollout instead of ad hoc local config edits',
      evidence: 'plugins/codex-profile/README.md documents the standalone bundle, repo-local plugin surface, and auto-updating manual MCP profile.',
      proofTrigger: 'They care about controlled rollout, support docs, and proof links more than raw plugin novelty.',
      proofAsset: INSTALL_DOC_URL,
      recommendedMotion: 'Qualify the team for the Workflow Hardening Sprint before pitching Team expansion.',
      nextAskBase: links.sprintLink,
      tracking: {
        utmCampaign: 'codex_repo_rollout',
        utmContent: 'workflow_sprint',
        campaignVariant: 'repo_backed_rollout',
        offerCode: 'CODEX-REPO_ROLLOUT',
        ctaId: 'codex_repo_rollout',
        ctaPlacement: 'operator_queue',
        surface: 'codex_rollout_queue',
      },
    },
  ];

  return queue.map(({ nextAskBase, tracking, ...entry }) => ({
    ...entry,
    nextAsk: buildTrackedCodexLink(nextAskBase, tracking),
  }));
}

function buildOutreachDrafts(links = buildRevenueLinks()) {
  const installLink = buildTrackedCodexLink(`${links.appOrigin}/codex-plugin`, {
    utmCampaign: 'codex_outreach_install',
    utmContent: 'plugin_page',
    campaignVariant: 'install_follow_up',
    offerCode: 'CODEX-OUTREACH_INSTALL',
    ctaId: 'codex_outreach_install',
    ctaPlacement: 'outreach_draft',
  });
  const sprintLink = buildTrackedCodexLink(links.sprintLink, {
    utmCampaign: 'codex_outreach_sprint',
    utmContent: 'workflow_sprint',
    campaignVariant: 'proof_first_team',
    offerCode: 'CODEX-OUTREACH_SPRINT',
    ctaId: 'codex_outreach_sprint',
    ctaPlacement: 'outreach_draft',
    surface: 'codex_outreach',
  });

  return [
    {
      key: 'install_follow_up',
      channel: 'GitHub DM or email',
      audience: 'Solo Codex operator',
      draft: `You already have Codex. The missing piece is blocking one repeated mistake before the next tool call, not adding another memory note. ThumbGate now has a direct Codex install page, standalone bundle, and proof links in one place: ${installLink} . If you can name one repeated command or file-edit failure, that page gives the fastest path to prove the block locally.`,
    },
    {
      key: 'proof_first_team',
      channel: 'Founder note',
      audience: 'Platform lead or consultancy owner',
      draft: `I am not pitching another agent platform. I am pitching one Codex-adjacent workflow that becomes safe enough to ship because the repeated mistake gets turned into a Pre-Action Check and the proof stays inspectable. If your team already has one owner and one repeated approval-boundary failure, the next useful step is the Workflow Hardening Sprint intake: ${sprintLink} .`,
    },
    {
      key: 'bridge_lane',
      channel: 'Reply or follow-up comment',
      audience: 'Claude Code team evaluating Codex as a second reviewer',
      draft: `If the team already trusts Claude Code but wants a Codex second-pass lane, ThumbGate keeps the same local feedback memory while Codex handles review or adversarial review. The bridge surface is here: ${BRIDGE_README_URL} . If that maps to a real workflow with one owner, route it to the sprint intake instead of a generic plugin pitch.`,
    },
  ];
}

function buildMeasurementPlan() {
  return {
    northStar: 'codex_install_to_paid_intent',
    policy: 'Treat Codex installs as useful only when they produce a tracked Pro checkout start or a qualified sprint conversation.',
    metrics: [
      'codex_plugin_page_visits',
      'codex_bundle_downloads',
      'codex_install_doc_clicks',
      'codex_proof_clicks',
      'codex_pro_checkout_starts',
      'codex_qualified_team_conversations',
    ],
    guardrails: [
      'Do not claim installs, revenue, or marketplace approval without direct command evidence.',
      'Do not pitch Team before the buyer names one repeated workflow failure and one owner.',
      'Keep pricing and traction claims aligned with COMMERCIAL_TRUTH.md.',
    ],
  };
}

function buildCodexMarketplaceRevenuePack(links = buildRevenueLinks(), about = readGitHubAbout(), repoRoot = REPO_ROOT) {
  return {
    generatedAt: new Date().toISOString(),
    channel: 'Codex',
    objective: 'Turn Codex plugin interest into proof-backed installs, Pro checkout starts, and qualified workflow sprint conversations.',
    canonicalIdentity: {
      displayName: 'ThumbGate for Codex',
      repositoryUrl: about.repositoryUrl,
      homepageUrl: about.homepageUrl,
      installPageUrl: `${links.appOrigin}/codex-plugin`,
      shortDescription: CANONICAL_SHORT_DESCRIPTION,
    },
    evidenceSurfaces: buildEvidenceSurfaces(links, about, repoRoot),
    listingCopy: buildListingCopy(links),
    operatorQueue: buildOperatorQueue(links),
    outreachDrafts: buildOutreachDrafts(links),
    measurementPlan: buildMeasurementPlan(),
  };
}

function renderNamedSection(name, lines) {
  return [name, ...lines, ''];
}

function renderCodexMarketplaceRevenuePackMarkdown(pack) {
  const surfaceLines = pack.evidenceSurfaces.flatMap((surface) => renderNamedSection(`### ${surface.name}`, [
    `- URL: ${surface.url}`,
    ...(surface.versionedUrl ? [`- Versioned URL: ${surface.versionedUrl}`] : []),
    `- Operator use: ${surface.operatorUse}`,
    `- Buyer signal: ${surface.buyerSignal}`,
    `- Evidence source: ${surface.evidenceSource}`,
    `- Proof: ${surface.proofUrl}`,
    `- Support: ${surface.supportUrl}`,
    `- Proof links: ${surface.proofLinks.join(' | ')}`,
  ]));
  const queueLines = pack.operatorQueue.flatMap((entry) => renderNamedSection(`### ${entry.persona}`, [
    `- Evidence: ${entry.evidence}`,
    `- Proof trigger: ${entry.proofTrigger}`,
    `- Proof asset: ${entry.proofAsset}`,
    `- Next ask: ${entry.nextAsk}`,
    `- Motion: ${entry.recommendedMotion}`,
  ]));
  const outreachLines = pack.outreachDrafts.flatMap((entry) => renderNamedSection(`### ${entry.channel} — ${entry.audience}`, [
    '',
    entry.draft,
  ]));

  return [
    '# Codex Operator Revenue Pack',
    '',
    `Updated: ${pack.generatedAt}`,
    '',
    'This is a sales operator artifact. It is not proof of installs, revenue, or marketplace approval by itself.',
    '',
    '## Objective',
    pack.objective,
    '',
    '## Canonical Identity',
    `- Display name: ${pack.canonicalIdentity.displayName}`,
    `- Repository: ${pack.canonicalIdentity.repositoryUrl}`,
    `- Homepage: ${pack.canonicalIdentity.homepageUrl}`,
    `- Install page: ${pack.canonicalIdentity.installPageUrl}`,
    `- Short description: ${pack.canonicalIdentity.shortDescription}`,
    '',
    '## Verified Codex Surfaces',
    ...surfaceLines,
    '## Listing Copy',
    `- Headline: ${pack.listingCopy.headline}`,
    `- Subhead: ${pack.listingCopy.subhead}`,
    `- Short description: ${pack.listingCopy.shortDescription}`,
    '- Proof bullets:',
    ...pack.listingCopy.proofBullets.map((bullet) => `  - ${bullet}`),
    `- Primary CTA: ${pack.listingCopy.primaryCta.label} — ${pack.listingCopy.primaryCta.url}`,
    `- Secondary CTA: ${pack.listingCopy.secondaryCta.label} — ${pack.listingCopy.secondaryCta.url}`,
    `- Proof CTA: ${pack.listingCopy.proofCta.label} — ${pack.listingCopy.proofCta.url}`,
    '- Follow-on offers:',
    ...pack.listingCopy.followOnOffers.map((offer) => `  - ${offer.label} (${offer.pricing}) -> ${offer.cta}`),
    '',
    '## Operator Queue',
    ...queueLines,
    '## Outreach Drafts',
    ...outreachLines,
    '## Measurement Guardrails',
    `- North star: ${pack.measurementPlan.northStar}`,
    `- Policy: ${pack.measurementPlan.policy}`,
    '- Tracked metrics:',
    ...pack.measurementPlan.metrics.map((metric) => `  - ${metric}`),
    '- Guardrails:',
    ...pack.measurementPlan.guardrails.map((guardrail) => `  - ${guardrail}`),
    '',
  ].join('\n');
}

function renderCodexOperatorQueueCsv(pack) {
  const rows = [
    ['key', 'persona', 'evidence', 'proofTrigger', 'proofAsset', 'nextAsk', 'recommendedMotion'],
    ...pack.operatorQueue.map((entry) => ([
      entry.key,
      entry.persona,
      entry.evidence,
      entry.proofTrigger,
      entry.proofAsset,
      entry.nextAsk,
      entry.recommendedMotion,
    ])),
  ];

  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function renderCodexMarketplaceSurfacesCsv(pack) {
  const rows = [
    [
      'key',
      'name',
      'operatorUse',
      'buyerSignal',
      'url',
      'versionedUrl',
      'proofUrl',
      'supportUrl',
      'evidenceSource',
      'repositoryUrl',
      'proofLinks',
    ],
    ...pack.evidenceSurfaces.map((surface) => ([
      surface.key,
      surface.name,
      surface.operatorUse,
      surface.buyerSignal,
      surface.url,
      surface.versionedUrl || '',
      surface.proofUrl,
      surface.supportUrl,
      surface.evidenceSource,
      surface.repositoryUrl,
      Array.isArray(surface.proofLinks) ? surface.proofLinks.join('; ') : '',
    ])),
  ];

  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

const parseArgs = parseReportArgs;

function writeCodexMarketplaceRevenuePack(pack, options = {}) {
  const markdown = renderCodexMarketplaceRevenuePackMarkdown(pack);
  const queueCsv = renderCodexOperatorQueueCsv(pack);
  const surfacesCsv = renderCodexMarketplaceSurfacesCsv(pack);
  return writeRevenuePackArtifacts({
    repoRoot: REPO_ROOT,
    reportDir: options.reportDir,
    writeDocs: options.writeDocs,
    docsPath: path.join(REPO_ROOT, 'docs', 'marketing', 'codex-marketplace-revenue-pack.md'),
    markdown,
    jsonName: 'codex-marketplace-revenue-pack.json',
    jsonValue: pack,
    csvArtifacts: [
      {
        name: 'codex-operator-queue.csv',
        value: queueCsv,
      },
      {
        name: 'codex-marketplace-surfaces.csv',
        value: surfacesCsv,
      },
    ],
  });
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const pack = buildCodexMarketplaceRevenuePack();
  const written = writeCodexMarketplaceRevenuePack(pack, options);

  console.log('Codex marketplace revenue pack ready.');
  if (written.docsPath) {
    console.log(`Docs updated: ${written.docsPath}`);
  }
  if (written.reportDir) {
    console.log(`Artifacts written to ${written.reportDir}`);
  }
  console.log(JSON.stringify({
    surfaces: pack.evidenceSurfaces.length,
    queueRows: pack.operatorQueue.length,
    outreachDrafts: pack.outreachDrafts.length,
  }, null, 2));
}

function isCliInvocation(argv = process.argv) {
  return isCliCall(argv, __filename);
}

if (isCliInvocation()) {
  try {
    main();
  } catch (err) {
    console.error(err?.message || err);
    process.exit(1);
  }
}

module.exports = {
  CANONICAL_HEADLINE,
  CANONICAL_SHORT_DESCRIPTION,
  buildCodexMarketplaceRevenuePack,
  buildEvidenceSurfaces,
  buildListingCopy,
  buildMeasurementPlan,
  buildOperatorQueue,
  buildOutreachDrafts,
  buildTrackedCodexLink,
  isCliInvocation,
  parseArgs,
  renderCodexMarketplaceRevenuePackMarkdown,
  renderCodexMarketplaceSurfacesCsv,
  renderCodexOperatorQueueCsv,
  writeCodexMarketplaceRevenuePack,
};
