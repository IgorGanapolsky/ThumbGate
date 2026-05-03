#!/usr/bin/env node
'use strict';

const path = require('node:path');
const {
  COMMERCIAL_TRUTH_LINK,
  VERIFICATION_EVIDENCE_LINK,
  buildRevenueLinks,
} = require('./gtm-revenue-loop');
const {
  buildTrackedPackLink,
  csvCell,
  isCliInvocation: isCliCall,
  parseReportArgs,
  renderOperatorQueueCsv,
  renderRevenuePackMarkdown,
  writeRevenuePackArtifacts,
} = require('./revenue-pack-utils');

const REPO_ROOT = path.resolve(__dirname, '..');
const DOCS_PATH = path.join(REPO_ROOT, 'docs', 'marketing', 'mcp-directory-revenue-pack.md');
const MCP_SO_URL = 'https://mcp.so/server/thumbgate/IgorGanapolsky';
const GLAMA_SEARCH_URL = 'https://glama.ai/mcp/servers?query=thumbgate';
const GLAMA_LEGACY_URL = 'https://glama.ai/mcp/servers/IgorGanapolsky/mcp-memory-gateway';
const SMITHERY_SEARCH_URL = 'https://smithery.ai/search?q=thumbgate';
const SMITHERY_DETAILS_URL = 'https://smithery.ai/servers/rlhf-loop/thumbgate';
const PUNKPEYE_LIST_URL = 'https://github.com/punkpeye/awesome-mcp-servers';
const APPCYPHER_LIST_URL = 'https://github.com/appcypher/awesome-mcp-servers';
const MCP_DIRECTORIES_GUIDE_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/marketing/mcp-directories.md';
const MCP_HUB_SUBMISSION_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/mcp-hub-submission.md';
const CHECKED_AT = '2026-04-29';
const DIRECTORY_SOURCE = 'mcp_directories';
const DIRECTORY_MEDIUM = 'directory';
const DIRECTORY_SURFACE = 'mcp_directory';
const DIRECTORY_GUIDE_SUPPORT_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/marketing/mcp-directories.md';
const CANONICAL_DIRECTORY_DESCRIPTION = 'ThumbGate is the pre-action gates layer for AI coding agents: capture explicit feedback, regenerate prevention rules, and block repeated mistakes before risky tool calls run again.';
const PUNKPEYE_ENTRY = '- [thumbgate](https://github.com/IgorGanapolsky/ThumbGate) - Pre-action checks that physically block AI coding agents from repeating known mistakes. Captures feedback, auto-promotes failures into prevention rules, and enforces them via PreToolUse hooks.';
const APPCYPHER_ENTRY = '- **[thumbgate](https://github.com/IgorGanapolsky/ThumbGate)** - Pre-action checks that physically block AI coding agents from repeating known mistakes. Captures feedback, auto-promotes failures into prevention rules, and enforces them via PreToolUse hooks. (Node.js)';

function renderMcpDirectorySurfacesCsv(pack = {}) {
  const surfaces = Array.isArray(pack.surfaces) ? pack.surfaces : [];
  const rows = [
    [
      'key',
      'name',
      'role',
      'operatorStatus',
      'conversionGoal',
      'buyer',
      'surfaceUrl',
      'submissionPath',
      'homepageUrl',
      'proofUrl',
      'supportUrl',
      'shortDescription',
      'submissionCopy',
      'tags',
    ],
    ...surfaces.map((surface) => ([
      surface.key,
      surface.name,
      surface.role,
      surface.operatorStatus,
      surface.conversionGoal,
      surface.buyer,
      surface.surfaceUrl,
      surface.submissionPath,
      surface.homepageUrl,
      surface.proof,
      surface.support,
      surface.shortDescription,
      surface.submissionCopy,
      Array.isArray(surface.tags) ? surface.tags.join('|') : '',
    ])),
  ];

  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function buildTrackedDirectoryLink(baseUrl, tracking = {}) {
  return buildTrackedPackLink(baseUrl, tracking, {
    utmSource: DIRECTORY_SOURCE,
    utmMedium: DIRECTORY_MEDIUM,
    surface: tracking.surface || DIRECTORY_SURFACE,
  });
}

function buildDirectorySurface(config, links) {
  return {
    key: config.key,
    name: config.name,
    role: config.role,
    publicStatus: config.publicStatus,
    operatorStatus: config.operatorStatus,
    operatorUse: config.operatorUse,
    buyer: config.buyer,
    conversionGoal: config.conversionGoal,
    surfaceUrl: config.surfaceUrl,
    submissionPath: config.submissionPath,
    homepageUrl: buildTrackedDirectoryLink(links.guideLink, {
      utmCampaign: config.utmCampaign,
      utmContent: 'guide',
      campaignVariant: config.campaignVariant,
      offerCode: config.offerCode,
      ctaId: config.ctaId,
      ctaPlacement: 'directory_surface',
      surface: config.surfaceKey,
    }),
    shortDescription: config.shortDescription,
    submissionCopy: config.submissionCopy,
    support: DIRECTORY_GUIDE_SUPPORT_URL,
    evidenceCheckedAt: CHECKED_AT,
    evidenceSummary: config.evidenceSummary,
    nextRepair: config.nextRepair,
    proof: VERIFICATION_EVIDENCE_LINK,
    tags: config.tags,
    tagsLabel: Array.isArray(config.tags) ? config.tags.join(', ') : '',
  };
}

function buildSurfaces(links = buildRevenueLinks()) {
  return [
    buildDirectorySurface({
      key: 'mcp_so',
      name: 'MCP.so canonical listing',
      role: 'Live discovery surface with the current ThumbGate slug.',
      publicStatus: 'Live on the canonical `thumbgate/IgorGanapolsky` path.',
      operatorStatus: 'Treat as the canonical control listing and keep copy aligned with proof docs.',
      operatorUse: 'Use as the reference listing while repairing drift everywhere else.',
      buyer: 'Directory visitors validating the current ThumbGate identity before clicking through.',
      conversionGoal: 'directory_view_to_guide_click',
      surfaceUrl: MCP_SO_URL,
      submissionPath: 'https://mcp.so/submit',
      utmCampaign: 'mcp_so_guide',
      campaignVariant: 'canonical_listing',
      offerCode: 'MCP-SO_GUIDE',
      ctaId: 'mcp_so_guide',
      surfaceKey: 'mcp_so_guide',
      shortDescription: CANONICAL_DIRECTORY_DESCRIPTION,
      submissionCopy: 'ThumbGate is the pre-action gates layer for AI coding agents: capture explicit feedback, regenerate prevention rules, and block repeated mistakes before risky tool calls run again.',
      evidenceSummary: 'Direct curl check confirmed the page title `Thumbgate MCP Server`, current ThumbGate overview copy, and the canonical GitHub link.',
      nextRepair: 'Keep description and proof links aligned with `COMMERCIAL_TRUTH.md` and `VERIFICATION_EVIDENCE.md` as the canonical directory copy.',
      tags: ['mcp', 'directory', 'thumbgate', 'pre-action-checks', 'agent-reliability'],
    }, links),
    buildDirectorySurface({
      key: 'glama',
      name: 'Glama search result',
      role: 'High-volume MCP registry search surface that still leaks legacy naming.',
      publicStatus: 'Search for `thumbgate` resolves to the legacy slug `IgorGanapolsky/mcp-memory-gateway`.',
      operatorStatus: 'Repair the visible slug and summary before treating Glama as active acquisition.',
      operatorUse: 'Repair the public slug, summary, and package naming before pushing more Glama-facing discovery.',
      buyer: 'Glama searchers comparing MCP servers before they click into a listing or repository.',
      conversionGoal: 'directory_repair_to_guide_click',
      surfaceUrl: GLAMA_SEARCH_URL,
      submissionPath: GLAMA_LEGACY_URL,
      utmCampaign: 'glama_guide',
      campaignVariant: 'legacy_slug_repair',
      offerCode: 'GLAMA-GUIDE',
      ctaId: 'glama_guide',
      surfaceKey: 'glama_guide',
      shortDescription: CANONICAL_DIRECTORY_DESCRIPTION,
      submissionCopy: 'Please update the Glama listing so the slug, repository, and description all point to `IgorGanapolsky/ThumbGate` and describe ThumbGate as pre-action gates that block repeated agent mistakes before risky tool calls run again.',
      evidenceSummary: 'Search HTML exposes `ThumbGate` as the display name but still points to the legacy `mcp-memory-gateway` slug and legacy plain-text description.',
      nextRepair: 'Claim or update the listing so the slug, repo name, and summary are ThumbGate-only and no longer mention the old gateway positioning.',
      tags: ['glama', 'mcp', 'directory-repair', 'thumbgate'],
    }, links),
    buildDirectorySurface({
      key: 'smithery',
      name: 'Smithery search result',
      role: 'Installer-facing directory surface with a legacy namespace result.',
      publicStatus: 'Search returns `rlhf-loop/thumbgate` with `0 connections` instead of a canonical ThumbGate namespace.',
      operatorStatus: 'Prepare publish-ready metadata before treating Smithery as a live install lane.',
      operatorUse: 'Publish or repair the canonical Smithery listing before treating Smithery as an active acquisition lane.',
      buyer: 'Smithery users who want an installable MCP surface and a proof-backed next click.',
      conversionGoal: 'directory_repair_to_install_surface_click',
      surfaceUrl: SMITHERY_SEARCH_URL,
      submissionPath: 'https://smithery.ai/new',
      utmCampaign: 'smithery_guide',
      campaignVariant: 'namespace_repair',
      offerCode: 'SMITHERY-GUIDE',
      ctaId: 'smithery_guide',
      surfaceKey: 'smithery_guide',
      shortDescription: CANONICAL_DIRECTORY_DESCRIPTION,
      submissionCopy: 'ThumbGate is the pre-action gates layer for AI coding agents: capture explicit feedback, regenerate prevention rules, and block repeated mistakes before risky tool calls run again. Publish it under the canonical ThumbGate namespace and repository `IgorGanapolsky/ThumbGate`.',
      evidenceSummary: 'Direct search output shows `thumbgate [remote]`, the legacy `rlhf-loop/thumbgate` namespace, and a details link at the legacy path.',
      nextRepair: 'Publish or migrate Smithery metadata to a canonical ThumbGate namespace and retire the legacy `rlhf-loop` ownership path.',
      tags: ['smithery', 'mcp', 'directory-repair', 'thumbgate'],
    }, links),
    buildDirectorySurface({
      key: 'punkpeye',
      name: 'punkpeye awesome-mcp-servers',
      role: 'Largest GitHub awesome-list discovery surface in the current repo research.',
      publicStatus: 'Listed, but under the legacy repository `IgorGanapolsky/mcp-memory-gateway`.',
      operatorStatus: 'Use a minimal README repair PR instead of a net-new positioning rewrite.',
      operatorUse: 'Open a repair PR that swaps the repo name and keeps the description ThumbGate-only.',
      buyer: 'GitHub readers scanning trusted awesome lists for a credible MCP starting point.',
      conversionGoal: 'awesome_list_view_to_guide_click',
      surfaceUrl: PUNKPEYE_LIST_URL,
      submissionPath: 'https://github.com/punkpeye/awesome-mcp-servers/blob/main/README.md',
      utmCampaign: 'punkpeye_guide',
      campaignVariant: 'awesome_list_repair',
      offerCode: 'PUNKPEYE-GUIDE',
      ctaId: 'punkpeye_guide',
      surfaceKey: 'punkpeye_guide',
      shortDescription: CANONICAL_DIRECTORY_DESCRIPTION,
      submissionCopy: PUNKPEYE_ENTRY,
      evidenceSummary: 'README search returns a live entry, but it still points to `IgorGanapolsky/mcp-memory-gateway` instead of `IgorGanapolsky/ThumbGate`.',
      nextRepair: 'Submit a PR replacing the legacy repo path with the ThumbGate repo while keeping the pre-action gates description.',
      tags: ['github', 'awesome-list', 'directory-repair', 'thumbgate'],
    }, links),
    buildDirectorySurface({
      key: 'appcypher',
      name: 'appcypher awesome-mcp-servers',
      role: 'Secondary GitHub discovery list that currently has no ThumbGate entry.',
      publicStatus: 'No ThumbGate entry found in the current README search.',
      operatorStatus: 'Treat as clean expansion only after the higher-reach repair surfaces are already queued.',
      operatorUse: 'Treat this as a clean add-listing submission, not a rename repair.',
      buyer: 'Researchers comparing multiple awesome lists before choosing an install surface.',
      conversionGoal: 'awesome_list_view_to_guide_click',
      surfaceUrl: APPCYPHER_LIST_URL,
      submissionPath: 'https://github.com/appcypher/awesome-mcp-servers',
      utmCampaign: 'appcypher_guide',
      campaignVariant: 'awesome_list_expansion',
      offerCode: 'APPCYPHER-GUIDE',
      ctaId: 'appcypher_guide',
      surfaceKey: 'appcypher_guide',
      shortDescription: CANONICAL_DIRECTORY_DESCRIPTION,
      submissionCopy: APPCYPHER_ENTRY,
      evidenceSummary: 'README search returned no `thumbgate` or `IgorGanapolsky` matches, so this surface is still missing entirely.',
      nextRepair: 'Open a new listing PR with ThumbGate-only copy and the canonical GitHub repository.',
      tags: ['github', 'awesome-list', 'directory-expansion', 'thumbgate'],
    }, links),
  ];
}

function buildFollowOnOffers(links = buildRevenueLinks()) {
  return [
    {
      label: 'Proof-backed setup guide',
      pricing: 'Discovery CTA',
      buyer: 'Directory visitors who want a current install and proof surface before anything sales-led.',
      cta: buildTrackedDirectoryLink(links.guideLink, {
        utmCampaign: 'mcp_directory_guide',
        utmContent: 'guide',
        campaignVariant: 'directory_repair',
        offerCode: 'MCP-DIRECTORY_GUIDE',
        ctaId: 'mcp_directory_guide',
        ctaPlacement: 'follow_on_offer',
        surface: 'mcp_directory_guide',
      }),
    },
    {
      label: 'ThumbGate Pro',
      pricing: links.proPriceLabel,
      buyer: 'Directory visitors who already want the self-serve path and need a tracked paid-intent lane after the guide.',
      cta: buildTrackedDirectoryLink(links.proCheckoutLink, {
        utmCampaign: 'mcp_directory_pro',
        utmContent: 'pro',
        campaignVariant: 'self_serve_paid_intent',
        offerCode: 'MCP-DIRECTORY_PRO',
        ctaId: 'mcp_directory_pro',
        ctaPlacement: 'follow_on_offer',
        planId: 'pro',
        surface: 'mcp_directory_pro',
      }),
    },
    {
      label: 'Workflow Hardening Sprint',
      pricing: 'Primary revenue motion',
      buyer: 'Teams that already named one repeated workflow failure and want rollout proof, not just a directory listing.',
      cta: buildTrackedDirectoryLink(links.sprintLink, {
        utmCampaign: 'mcp_directory_sprint',
        utmContent: 'workflow_sprint',
        campaignVariant: 'repair_to_team_motion',
        offerCode: 'MCP-DIRECTORY_SPRINT',
        ctaId: 'mcp_directory_sprint',
        ctaPlacement: 'follow_on_offer',
        surface: 'mcp_directory_sprint',
      }),
    },
  ];
}

function buildOperatorQueue() {
  return [
    {
      key: 'repair_glama_slug',
      audience: 'Glama listing owner or claimant',
      evidence: 'Search for `thumbgate` still resolves to `IgorGanapolsky/mcp-memory-gateway`, which leaks the retired product identity into a major MCP registry.',
      proofTrigger: 'Do this before sending more discovery traffic into Glama because the current slug and summary still encode legacy positioning.',
      proofAsset: GLAMA_SEARCH_URL,
      nextAsk: GLAMA_LEGACY_URL,
      recommendedMotion: 'Claim or edit the Glama listing so the slug, summary, and repo link are ThumbGate-only.',
    },
    {
      key: 'repair_smithery_namespace',
      audience: 'Smithery publisher or maintainer',
      evidence: 'Smithery search returns the legacy `rlhf-loop/thumbgate` namespace with no canonical ThumbGate ownership path.',
      proofTrigger: 'Fix before treating Smithery as a live install lane because the namespace itself is still legacy.',
      proofAsset: SMITHERY_SEARCH_URL,
      nextAsk: SMITHERY_DETAILS_URL,
      recommendedMotion: 'Publish or migrate Smithery to a canonical ThumbGate namespace and retire `rlhf-loop`.',
    },
    {
      key: 'update_punkpeye_entry',
      audience: 'GitHub awesome-list maintainer or contributor',
      evidence: 'The most visible awesome list already carries a live entry, but it still points to `IgorGanapolsky/mcp-memory-gateway`.',
      proofTrigger: 'Repair before doing net-new list work because this is a direct naming mismatch on an already-indexed surface.',
      proofAsset: PUNKPEYE_LIST_URL,
      nextAsk: 'https://github.com/punkpeye/awesome-mcp-servers/pulls',
      recommendedMotion: 'Open a small README PR that swaps the repo URL to `IgorGanapolsky/ThumbGate` and preserves the pre-action gates thesis.',
    },
    {
      key: 'add_appcypher_entry',
      audience: 'GitHub awesome-list maintainer or contributor',
      evidence: 'No current ThumbGate entry exists in the appcypher list, so this is clean acquisition expansion instead of repair.',
      proofTrigger: 'Only pursue after the legacy-name repairs are underway so new discovery traffic sees one canonical identity.',
      proofAsset: APPCYPHER_LIST_URL,
      nextAsk: 'https://github.com/appcypher/awesome-mcp-servers/pulls',
      recommendedMotion: 'Open a new listing PR with ThumbGate-only copy, the npm package, and the canonical GitHub repository.',
    },
    {
      key: 'keep_mcp_so_canonical',
      audience: 'Directory maintenance owner',
      evidence: 'MCP.so already exposes the correct ThumbGate slug and current overview, so it can anchor every other repair.',
      proofTrigger: 'Use as the backstop whenever a directory repair needs a live canonical listing reference.',
      proofAsset: MCP_SO_URL,
      nextAsk: MCP_SO_URL,
      recommendedMotion: 'Preserve this listing as the canonical reference and mirror its ThumbGate-only naming everywhere else.',
    },
  ];
}

function buildOutreachDrafts() {
  return [
    {
      channel: 'Glama claim or support request',
      audience: 'Glama listing maintainer',
      draft: 'ThumbGate currently appears in Glama search under the legacy `IgorGanapolsky/mcp-memory-gateway` slug even though the active repository, npm package, and public launch surface are all `ThumbGate`. Please update the slug and summary so the listing points to `IgorGanapolsky/ThumbGate` and uses ThumbGate-only copy.',
    },
    {
      channel: 'Smithery publish note',
      audience: 'Smithery publisher',
      draft: 'The current Smithery search result for `thumbgate` resolves to the legacy `rlhf-loop/thumbgate` namespace. The active package and repository are `thumbgate` and `IgorGanapolsky/ThumbGate`. Publish or migrate the listing under the canonical ThumbGate namespace before treating Smithery as a live acquisition lane.',
    },
    {
      channel: 'punkpeye README PR body',
      audience: 'awesome-mcp-servers maintainer',
      draft: 'This PR updates the ThumbGate entry from the retired `IgorGanapolsky/mcp-memory-gateway` repository to the active `IgorGanapolsky/ThumbGate` repository. The description remains focused on ThumbGate as pre-action gates that prevent AI coding agents from repeating known mistakes.',
    },
    {
      channel: 'appcypher README PR body',
      audience: 'awesome-mcp-servers maintainer',
      draft: 'This PR adds ThumbGate to the list using the canonical repository and current product language. ThumbGate is the pre-action gates layer for AI coding agents: it captures explicit feedback, turns repeated failures into prevention rules, and blocks repeat mistakes before risky actions run again.',
    },
  ];
}

function buildMeasurementPlan() {
  return {
    northStar: 'directory_referral_to_paid_intent',
    policy: 'Treat directory presence as acquisition evidence only after a tracked guide click, install-surface click, or qualified workflow conversation exists.',
    minimumUsefulSignal: 'One tracked setup-guide visit or workflow-sprint conversation sourced from a repaired directory surface.',
    strongSignal: 'Three tracked paid-intent events sourced from repaired directory referrals across guide, Pro, or sprint lanes.',
    metrics: [
      'directory_referral_clicks',
      'guide_visits_from_directories',
      'codex_plugin_page_visits_from_directories',
      'workflow_sprint_intake_submissions_from_directories',
      'pro_checkout_starts_from_directories',
    ],
    guardrails: [
      'Do not claim directory approval, ranking, installs, or revenue without direct command evidence.',
      'Do not ship new directory copy that mentions `mcp-memory-gateway`, `rlhf-loop`, or other retired product names as active surfaces.',
      'Keep pricing aligned with COMMERCIAL_TRUTH.md.',
      'Keep proof claims aligned with VERIFICATION_EVIDENCE.md.',
    ],
    milestones: [
      {
        window: 'days_0_30',
        goal: 'Repair legacy naming on Glama, Smithery, and the highest-reach awesome list before broadening directory distribution.',
        decisionRule: 'Do not add lower-priority directories until the visible legacy-name leaks are fixed or actively queued.',
      },
      {
        window: 'days_31_60',
        goal: 'Measure whether repaired directory referrals produce guide clicks or qualified workflow conversations.',
        decisionRule: 'If referral clicks exist without paid intent, move proof and install CTAs higher on the linked destination pages.',
      },
      {
        window: 'days_61_90',
        goal: 'Prune low-signal directories and keep only the surfaces that produce tracked downstream intent.',
        decisionRule: 'If a directory does not create tracked guide clicks or workflow conversations, stop treating it as an active acquisition lane.',
      },
    ],
    doNotCountAsSuccess: [
      'directory pages that still use legacy names',
      'directory visibility without a tracked downstream click',
      'unverified claims about official registry presence, approval, or paid traffic',
    ],
  };
}

function buildMcpDirectoryRevenuePack(links = buildRevenueLinks()) {
  return {
    generatedAt: new Date().toISOString(),
    objective: 'Repair MCP directory drift so ThumbGate discovery points to one canonical identity and one proof-backed install path.',
    state: 'directory-repair',
    headline: 'Fix legacy-name MCP directory drift before scaling discovery.',
    shortDescription: 'ThumbGate already has live MCP directory discovery, but major surfaces still leak retired names and old repo paths. Repair those first, then scale directory acquisition.',
    summary: 'Current checks show one canonical listing on MCP.so, two legacy-name directory results on Glama and Smithery, one legacy repo entry on the highest-reach awesome list, and one missing awesome-list entry.',
    canonicalIdentity: {
      displayName: 'ThumbGate',
      repository: 'https://github.com/IgorGanapolsky/ThumbGate',
      npmPackage: 'https://www.npmjs.com/package/thumbgate',
      homepage: links.appOrigin,
      commercialTruth: COMMERCIAL_TRUTH_LINK,
      verificationEvidence: VERIFICATION_EVIDENCE_LINK,
      supportDocs: MCP_HUB_SUBMISSION_URL,
    },
    surfaces: buildSurfaces(links),
    followOnOffers: buildFollowOnOffers(links),
    operatorQueue: buildOperatorQueue(),
    outreachDrafts: buildOutreachDrafts(),
    measurementPlan: buildMeasurementPlan(),
    proofLinks: [COMMERCIAL_TRUTH_LINK, VERIFICATION_EVIDENCE_LINK],
  };
}

function renderMcpDirectoryRevenuePackMarkdown(pack) {
  return renderRevenuePackMarkdown({
    title: 'MCP Directory Repair Pack',
    disclaimer: 'This is a sales operator artifact. It is not proof of directory approval, ranking, installs, or revenue by itself.',
    pack,
    canonicalFields: [
      { label: 'Display name', key: 'displayName' },
      { label: 'Repository', key: 'repository' },
      { label: 'npm package', key: 'npmPackage' },
      { label: 'Homepage', key: 'homepage' },
      { label: 'Commercial truth', key: 'commercialTruth' },
      { label: 'Verification evidence', key: 'verificationEvidence' },
      { label: 'Support docs', key: 'supportDocs' },
    ],
    surfaceFields: [
      { label: 'Role', key: 'role' },
      { label: 'Public status', key: 'publicStatus' },
      { label: 'Operator status', key: 'operatorStatus' },
      { label: 'Operator use', key: 'operatorUse' },
      { label: 'Buyer', key: 'buyer' },
      { label: 'Conversion goal', key: 'conversionGoal' },
      { label: 'Surface URL', key: 'surfaceUrl' },
      { label: 'Submission path', key: 'submissionPath' },
      { label: 'Homepage CTA', key: 'homepageUrl' },
      { label: 'Short description', key: 'shortDescription' },
      { label: 'Submission copy', key: 'submissionCopy' },
      { label: 'Support', key: 'support' },
      { label: 'Evidence checked', key: 'evidenceCheckedAt' },
      { label: 'Evidence summary', key: 'evidenceSummary' },
      { label: 'Next repair', key: 'nextRepair' },
      { label: 'Proof', key: 'proof' },
      { label: 'Tags', key: 'tagsLabel' },
    ],
  });
}

function writeMcpDirectoryRevenuePack(pack, options = {}) {
  return writeRevenuePackArtifacts({
    repoRoot: REPO_ROOT,
    reportDir: options.reportDir,
    writeDocs: options.writeDocs,
    docsPath: DOCS_PATH,
    markdown: renderMcpDirectoryRevenuePackMarkdown(pack),
    jsonName: 'mcp-directory-revenue-pack.json',
    jsonValue: pack,
    csvArtifacts: [
      {
        name: 'mcp-directory-operator-queue.csv',
        value: renderOperatorQueueCsv(pack?.operatorQueue),
      },
      {
        name: 'mcp-directory-surfaces.csv',
        value: renderMcpDirectorySurfacesCsv(pack),
      },
    ],
  });
}

function parseArgs(argv = []) {
  return parseReportArgs(argv);
}

function isCliInvocation(argv = process.argv) {
  return isCliCall(argv, __filename);
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const pack = buildMcpDirectoryRevenuePack();
  const written = writeMcpDirectoryRevenuePack(pack, options);

  if (written.docsPath) {
    console.log(`MCP directory repair pack updated: ${written.docsPath}`);
  }
  if (written.reportDir) {
    console.log(`Artifacts written to ${written.reportDir}`);
  }
}

if (isCliInvocation(process.argv)) {
  try {
    main();
  } catch (error) {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  }
}

module.exports = {
  APPCYPHER_LIST_URL,
  CHECKED_AT,
  DIRECTORY_MEDIUM,
  DIRECTORY_SOURCE,
  DIRECTORY_SURFACE,
  DOCS_PATH,
  GLAMA_LEGACY_URL,
  GLAMA_SEARCH_URL,
  MCP_SO_URL,
  PUNKPEYE_LIST_URL,
  SMITHERY_DETAILS_URL,
  SMITHERY_SEARCH_URL,
  buildMcpDirectoryRevenuePack,
  buildTrackedDirectoryLink,
  isCliInvocation,
  parseArgs,
  renderMcpDirectorySurfacesCsv,
  renderMcpDirectoryRevenuePackMarkdown,
  writeMcpDirectoryRevenuePack,
};
