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
const DRAFTS_CSV_NAME = 'mcp-directory-channel-drafts.csv';

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
      publicStatus: 'Live on the canonical `thumbgate/IgorGanapolsky` path.',
      operatorUse: 'Use as the reference listing while repairing drift everywhere else.',
      surfaceUrl: MCP_SO_URL,
      submissionPath: 'https://mcp.so/submit',
      support: MCP_DIRECTORIES_GUIDE_URL,
      evidenceCheckedAt: CHECKED_AT,
      evidenceSummary: 'Live page still shows the canonical ThumbGate title, current overview copy, Workflow Hardening Sprint CTA, and the canonical GitHub repository link.',
      nextRepair: 'Keep description and proof links aligned with `COMMERCIAL_TRUTH.md` and `VERIFICATION_EVIDENCE.md` as the canonical directory copy.',
      proof: VERIFICATION_EVIDENCE_LINK,
    },
    {
      key: 'glama',
      name: 'Glama canonical listing',
      role: 'High-volume MCP registry search surface with a canonical URL but stale legacy positioning in the summary.',
      publicStatus: 'Search now resolves to the canonical `IgorGanapolsky/ThumbGate` page, and the legacy `mcp-memory-gateway` URL 301-redirects there.',
      operatorUse: 'Refresh the public summary so Glama no longer describes ThumbGate as a memory gateway before pushing more directory traffic.',
      surfaceUrl: GLAMA_SEARCH_URL,
      submissionPath: GLAMA_CANONICAL_URL,
      support: MCP_DIRECTORIES_GUIDE_URL,
      evidenceCheckedAt: CHECKED_AT,
      evidenceSummary: 'Search JSON-LD now points at `IgorGanapolsky/ThumbGate`, but the indexed description still says ThumbGate provides "memory management and gateway capabilities" with persistent storage across sessions.',
      nextRepair: 'Update the canonical Glama description so it leads with pre-action gates, workflow safeguards, and repeat-mistake prevention instead of memory-gateway language.',
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
      role: 'Largest GitHub awesome-list discovery surface in the current repo research.',
      publicStatus: 'README now contains both a canonical `IgorGanapolsky/ThumbGate` entry and a stale duplicate `IgorGanapolsky/mcp-memory-gateway` entry.',
      operatorUse: 'Open a repair PR that removes the duplicate legacy row while preserving the canonical ThumbGate listing.',
      surfaceUrl: PUNKPEYE_LIST_URL,
      submissionPath: 'https://github.com/punkpeye/awesome-mcp-servers/blob/main/README.md',
      support: MCP_DIRECTORIES_GUIDE_URL,
      evidenceCheckedAt: CHECKED_AT,
      evidenceSummary: 'The raw README shows a canonical ThumbGate row around line 893 and a stale `mcp-memory-gateway` duplicate around line 1634, so buyers can still discover the retired identity.',
      nextRepair: 'Submit a PR deleting the legacy duplicate and keeping the canonical ThumbGate row plus its pre-action gates description.',
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
      key: 'refresh_glama_summary',
      audience: 'Glama listing owner or claimant',
      evidence: 'Glama search now lands on the canonical ThumbGate page, but the indexed summary still describes ThumbGate as a memory gateway with persistent storage across sessions.',
      proofTrigger: 'Refresh this before sending more discovery traffic into Glama because the summary still frames ThumbGate around retired gateway language.',
      proofAsset: GLAMA_SEARCH_URL,
      nextAsk: GLAMA_CANONICAL_URL,
      recommendedMotion: 'Edit the canonical Glama listing summary so it leads with pre-action gates, repeat-mistake prevention, and workflow safeguards.',
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
      evidence: 'The highest-reach awesome list now has both the canonical `IgorGanapolsky/ThumbGate` row and a stale `IgorGanapolsky/mcp-memory-gateway` duplicate.',
      proofTrigger: 'Repair this before doing net-new list work because discovery can still hit the retired identity even though the canonical row already exists.',
      proofAsset: PUNKPEYE_LIST_URL,
      nextAsk: 'https://github.com/punkpeye/awesome-mcp-servers/pulls',
      recommendedMotion: 'Open a small README PR that deletes the legacy duplicate row and preserves the canonical ThumbGate listing.',
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
      draft: 'ThumbGate now resolves to the canonical Glama page, but the summary still describes it as a memory gateway with persistent storage across sessions. The active positioning is pre-action gates for AI coding agents: repeated mistakes become enforceable checks before risky actions run. Please refresh the summary so the canonical ThumbGate listing reflects the current product.',
    },
    {
      channel: 'Smithery publish note',
      audience: 'Smithery publisher',
      draft: 'The current Smithery search result for `thumbgate` resolves to the legacy `rlhf-loop/thumbgate` namespace. The active package and repository are `thumbgate` and `IgorGanapolsky/ThumbGate`. Publish or migrate the listing under the canonical ThumbGate namespace before treating Smithery as a live acquisition lane.',
    },
    {
      channel: 'punkpeye duplicate-removal PR body',
      audience: 'awesome-mcp-servers maintainer',
      draft: 'This PR removes the stale `IgorGanapolsky/mcp-memory-gateway` duplicate and keeps the canonical `IgorGanapolsky/ThumbGate` row. ThumbGate is the active repository and package; the description remains focused on pre-action gates that prevent AI coding agents from repeating known mistakes.',
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
        goal: 'Repair Glama summary drift, Smithery namespace drift, and the punkpeye duplicate before broadening directory distribution.',
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
    headline: 'Fix stale MCP directory positioning before scaling discovery.',
    shortDescription: 'ThumbGate already has live MCP directory discovery, but major surfaces still leak retired gateway language, legacy namespaces, or duplicate old rows. Repair those first, then scale directory acquisition.',
    summary: 'Current checks show one canonical listing on MCP.so, a canonical-but-stale Glama summary, a legacy Smithery namespace, one punkpeye duplicate legacy row beside the canonical listing, and one missing awesome-list entry.',
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

function renderDraftsCsv(outreachDrafts = []) {
  const rows = [
    ['channel', 'audience', 'draft'],
    ...outreachDrafts.map((draft) => ([
      draft.channel,
      draft.audience,
      draft.draft,
    ])),
  ];

  return `${rows.map((row) => row.map((cell) => csvCell(cell)).join(',')).join('\n')}\n`;
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
        value: renderOperatorQueueCsv(pack.operatorQueue),
      },
      {
        name: DRAFTS_CSV_NAME,
        value: renderDraftsCsv(pack.outreachDrafts),
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
  DRAFTS_CSV_NAME,
  GLAMA_LEGACY_URL,
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
  renderDraftsCsv,
  renderMcpDirectoryRevenuePackMarkdown,
  writeMcpDirectoryRevenuePack,
};
