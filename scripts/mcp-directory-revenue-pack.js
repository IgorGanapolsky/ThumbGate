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
  isCliInvocation: isCliCall,
  parseReportArgs,
  renderRevenuePackMarkdown,
  writeStandardRevenuePack,
} = require('./revenue-pack-utils');

const REPO_ROOT = path.resolve(__dirname, '..');
const DOCS_PATH = path.join(REPO_ROOT, 'docs', 'marketing', 'mcp-directory-revenue-pack.md');
const MCP_SO_URL = 'https://mcp.so/server/thumbgate/IgorGanapolsky';
const GLAMA_SEARCH_URL = 'https://glama.ai/mcp/servers?query=thumbgate';
const GLAMA_CANONICAL_URL = 'https://glama.ai/mcp/servers/IgorGanapolsky/ThumbGate';
const SMITHERY_SEARCH_URL = 'https://smithery.ai/search?q=thumbgate';
const SMITHERY_DETAILS_URL = 'https://smithery.ai/servers/rlhf-loop/thumbgate';
const PUNKPEYE_LIST_URL = 'https://github.com/punkpeye/awesome-mcp-servers';
const APPCYPHER_LIST_URL = 'https://github.com/appcypher/awesome-mcp-servers';
const MCP_DIRECTORIES_GUIDE_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/marketing/mcp-directories.md';
const MCP_HUB_SUBMISSION_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/mcp-hub-submission.md';
const CHECKED_AT = '2026-05-02';
const DIRECTORY_SOURCE = 'mcp_directories';
const DIRECTORY_MEDIUM = 'directory';
const DIRECTORY_SURFACE = 'mcp_directory';

function buildTrackedDirectoryLink(baseUrl, tracking = {}) {
  return buildTrackedPackLink(baseUrl, tracking, {
    utmSource: DIRECTORY_SOURCE,
    utmMedium: DIRECTORY_MEDIUM,
    surface: tracking.surface || DIRECTORY_SURFACE,
  });
}

function buildSurfaces() {
  return [
    {
      key: 'mcp_so',
      name: 'MCP.so canonical listing',
      role: 'Live discovery surface with the current ThumbGate slug.',
      publicStatus: 'Live on the canonical `thumbgate/IgorGanapolsky` path with ThumbGate-specific CTA badges and repo links.',
      operatorUse: 'Use as the reference listing while repairing stale copy and duplicate legacy entries everywhere else.',
      surfaceUrl: MCP_SO_URL,
      submissionPath: 'https://mcp.so/submit',
      support: MCP_DIRECTORIES_GUIDE_URL,
      evidenceCheckedAt: CHECKED_AT,
      evidenceSummary: 'Direct curl check confirmed the page title `Thumbgate MCP Server`, ThumbGate-specific description, and ThumbGate CTA badges on the canonical slug.',
      nextRepair: 'Keep this page as the canonical naming and CTA reference whenever other directories need a ThumbGate-only repair target.',
      proof: VERIFICATION_EVIDENCE_LINK,
    },
    {
      key: 'glama',
      name: 'Glama canonical listing',
      role: 'High-volume MCP registry surface with a canonical ThumbGate slug but stale legacy positioning copy.',
      publicStatus: 'Search for `thumbgate` resolves to the canonical `IgorGanapolsky/ThumbGate` listing, but the embedded description still says "memory management and gateway capabilities."',
      operatorUse: 'Refresh the canonical listing description before pushing more Glama-facing discovery so buyers do not see the retired gateway story.',
      surfaceUrl: GLAMA_SEARCH_URL,
      submissionPath: GLAMA_CANONICAL_URL,
      support: MCP_DIRECTORIES_GUIDE_URL,
      evidenceCheckedAt: CHECKED_AT,
      evidenceSummary: 'Search HTML now points to `IgorGanapolsky/ThumbGate`, but the embedded `SoftwareApplication` description still uses the stale "memory management and gateway capabilities" copy.',
      nextRepair: 'Update the canonical Glama summary so it matches ThumbGate\'s pre-action gates positioning and no longer describes the product as a memory gateway.',
      proof: VERIFICATION_EVIDENCE_LINK,
    },
    {
      key: 'smithery',
      name: 'Smithery search result',
      role: 'Installer-facing directory surface with a legacy namespace result.',
      publicStatus: 'Search returns `rlhf-loop/thumbgate` with `0 connections` instead of a canonical ThumbGate namespace.',
      operatorUse: 'Publish or repair the canonical Smithery listing before treating Smithery as an active acquisition lane.',
      surfaceUrl: SMITHERY_SEARCH_URL,
      submissionPath: 'https://smithery.ai/new',
      support: MCP_DIRECTORIES_GUIDE_URL,
      evidenceCheckedAt: CHECKED_AT,
      evidenceSummary: 'Direct search output shows `thumbgate [remote]`, the legacy `rlhf-loop/thumbgate` namespace, and a details link at the legacy path.',
      nextRepair: 'Publish or migrate Smithery metadata to a canonical ThumbGate namespace and retire the legacy `rlhf-loop` ownership path.',
      proof: VERIFICATION_EVIDENCE_LINK,
    },
    {
      key: 'punkpeye',
      name: 'punkpeye awesome-mcp-servers',
      role: 'Largest GitHub awesome-list discovery surface in the current repo research, with both canonical and duplicate legacy entries.',
      publicStatus: 'README includes a canonical ThumbGate entry, but it still also includes a duplicate `IgorGanapolsky/mcp-memory-gateway` listing.',
      operatorUse: 'Open a cleanup PR that removes the duplicate legacy row and leaves only the canonical ThumbGate listing.',
      surfaceUrl: PUNKPEYE_LIST_URL,
      submissionPath: 'https://github.com/punkpeye/awesome-mcp-servers/blob/main/README.md',
      support: MCP_DIRECTORIES_GUIDE_URL,
      evidenceCheckedAt: CHECKED_AT,
      evidenceSummary: 'README search now returns both `IgorGanapolsky/ThumbGate` and a second legacy `IgorGanapolsky/mcp-memory-gateway` entry, which splits discovery across active and retired names.',
      nextRepair: 'Submit a PR that deletes the duplicate legacy row while preserving the canonical ThumbGate listing and pre-action gates thesis.',
      proof: VERIFICATION_EVIDENCE_LINK,
    },
    {
      key: 'appcypher',
      name: 'appcypher awesome-mcp-servers',
      role: 'Secondary GitHub discovery list that currently has no ThumbGate entry.',
      publicStatus: 'No ThumbGate entry found in the current README search.',
      operatorUse: 'Treat this as a clean add-listing submission, not a rename repair.',
      surfaceUrl: APPCYPHER_LIST_URL,
      submissionPath: 'https://github.com/appcypher/awesome-mcp-servers',
      support: MCP_DIRECTORIES_GUIDE_URL,
      evidenceCheckedAt: CHECKED_AT,
      evidenceSummary: 'README search returned no `thumbgate` or `IgorGanapolsky` matches, so this surface is still missing entirely.',
      nextRepair: 'Open a new listing PR with ThumbGate-only copy and the canonical GitHub repository.',
      proof: VERIFICATION_EVIDENCE_LINK,
    },
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
      key: 'refresh_glama_description',
      audience: 'Glama listing owner or claimant',
      evidence: 'Glama search now resolves to `IgorGanapolsky/ThumbGate`, but the listing description still says "memory management and gateway capabilities."',
      proofTrigger: 'Do this before sending more discovery traffic into Glama because the slug is fixed but the positioning still encodes the retired gateway story.',
      proofAsset: GLAMA_SEARCH_URL,
      nextAsk: GLAMA_CANONICAL_URL,
      recommendedMotion: 'Edit the canonical Glama listing description so it matches ThumbGate\'s pre-action gates positioning and proof-backed install path.',
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
      key: 'remove_punkpeye_duplicate',
      audience: 'GitHub awesome-list maintainer or contributor',
      evidence: 'The most visible awesome list now contains the canonical ThumbGate entry and a second legacy `mcp-memory-gateway` entry, which splits discovery across two names.',
      proofTrigger: 'Clean up the duplicate before doing net-new list work because indexers can still surface the retired repo alongside the active one.',
      proofAsset: PUNKPEYE_LIST_URL,
      nextAsk: 'https://github.com/punkpeye/awesome-mcp-servers/pulls',
      recommendedMotion: 'Open a small README PR that removes the duplicate `mcp-memory-gateway` row and keeps the canonical ThumbGate listing.',
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
      draft: 'ThumbGate now resolves to the canonical `IgorGanapolsky/ThumbGate` listing in Glama search, but the description still says "memory management and gateway capabilities." Please refresh the summary so it matches ThumbGate as pre-action gates for AI coding agents and points buyers at the current install path.',
    },
    {
      channel: 'Smithery publish note',
      audience: 'Smithery publisher',
      draft: 'The current Smithery search result for `thumbgate` resolves to the legacy `rlhf-loop/thumbgate` namespace. The active package and repository are `thumbgate` and `IgorGanapolsky/ThumbGate`. Publish or migrate the listing under the canonical ThumbGate namespace before treating Smithery as a live acquisition lane.',
    },
    {
      channel: 'punkpeye README PR body',
      audience: 'awesome-mcp-servers maintainer',
      draft: 'This PR removes the duplicate retired `IgorGanapolsky/mcp-memory-gateway` row because the canonical `IgorGanapolsky/ThumbGate` entry is already present. The remaining ThumbGate listing continues to position the project as pre-action gates that prevent AI coding agents from repeating known mistakes.',
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
        goal: 'Repair stale Glama copy, Smithery namespace drift, and the duplicate legacy awesome-list entry before broadening directory distribution.',
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
    headline: 'Fix stale MCP directory copy and duplicate legacy entries before scaling discovery.',
    shortDescription: 'ThumbGate already has live MCP directory discovery, but major surfaces still leak retired copy, legacy namespaces, or duplicate legacy repo entries. Repair those first, then scale directory acquisition.',
    summary: 'Current checks show one canonical listing on MCP.so, one canonical-but-stale listing on Glama, one legacy namespace on Smithery, one duplicate legacy repo entry on the highest-reach awesome list, and one missing awesome-list entry.',
    canonicalIdentity: {
      displayName: 'ThumbGate',
      repository: 'https://github.com/IgorGanapolsky/ThumbGate',
      npmPackage: 'https://www.npmjs.com/package/thumbgate',
      homepage: links.appOrigin,
      commercialTruth: COMMERCIAL_TRUTH_LINK,
      verificationEvidence: VERIFICATION_EVIDENCE_LINK,
      supportDocs: MCP_HUB_SUBMISSION_URL,
    },
    surfaces: buildSurfaces(),
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
      { label: 'Operator use', key: 'operatorUse' },
      { label: 'Surface URL', key: 'surfaceUrl' },
      { label: 'Submission path', key: 'submissionPath' },
      { label: 'Support', key: 'support' },
      { label: 'Evidence checked', key: 'evidenceCheckedAt' },
      { label: 'Evidence summary', key: 'evidenceSummary' },
      { label: 'Next repair', key: 'nextRepair' },
      { label: 'Proof', key: 'proof' },
    ],
  });
}

function writeMcpDirectoryRevenuePack(pack, options = {}) {
  return writeStandardRevenuePack({
    repoRoot: REPO_ROOT,
    docsPath: DOCS_PATH,
    pack,
    options,
    renderMarkdown: renderMcpDirectoryRevenuePackMarkdown,
    jsonName: 'mcp-directory-revenue-pack.json',
    csvName: 'mcp-directory-operator-queue.csv',
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
  GLAMA_CANONICAL_URL,
  GLAMA_SEARCH_URL,
  MCP_SO_URL,
  PUNKPEYE_LIST_URL,
  SMITHERY_DETAILS_URL,
  SMITHERY_SEARCH_URL,
  buildMcpDirectoryRevenuePack,
  buildTrackedDirectoryLink,
  isCliInvocation,
  parseArgs,
  renderMcpDirectoryRevenuePackMarkdown,
  writeMcpDirectoryRevenuePack,
};
