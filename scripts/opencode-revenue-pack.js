#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
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
  normalizeText,
  parseReportArgs,
  readGitHubAbout,
  renderOperatorQueueCsv,
  writeRevenuePackArtifacts,
} = require('./revenue-pack-utils');

const REPO_ROOT = path.resolve(__dirname, '..');
const REVENUE_LOOP_REPORT_PATH = path.join(REPO_ROOT, 'docs', 'marketing', 'gtm-revenue-loop.json');
const OPENCODE_SOURCE = 'opencode';
const GUIDE_MEDIUM = 'integration_guide';
const OUTREACH_MEDIUM = 'operator_outreach';
const OPENCODE_SURFACE = 'opencode';
const GUIDE_URL = 'https://thumbgate-production.up.railway.app/guide';
const OPENCODE_GUIDE_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/guides/opencode-integration.md';
const OPENCODE_INSTALL_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/plugins/opencode-profile/INSTALL.md';
const OPENCODE_CONFIG_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/opencode.json';
const MULTICA_GUIDE_URL = 'https://thumbgate-production.up.railway.app/guides/multica-thumbgate-setup';
const MULTICA_GUIDE_SOURCE_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/public/guides/multica-thumbgate-setup.html';
const PROOF_LINKS = [COMMERCIAL_TRUTH_LINK, VERIFICATION_EVIDENCE_LINK];
const TRACKING_DEFAULTS = {
  utmSource: OPENCODE_SOURCE,
  utmMedium: GUIDE_MEDIUM,
  utmCampaign: 'opencode_revenue_pack',
  utmContent: 'guide',
  surface: OPENCODE_SURFACE,
};
const CANONICAL_HEADLINE = 'Make OpenCode installs safe before the next risky edit.';
const CANONICAL_SHORT_DESCRIPTION = 'ThumbGate gives OpenCode a local-first MCP runtime, worktree-safe defaults, and Pre-Action Checks before the next risky tool call or edit runs.';

function buildTrackedOpenCodeLink(baseUrl, tracking = {}) {
  return buildTrackedPackLink(baseUrl, tracking, TRACKING_DEFAULTS);
}

function readRevenueLoopReport(reportPath = REVENUE_LOOP_REPORT_PATH) {
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch {
    return {};
  }
}

function countTargets(report = {}, matcher) {
  const targets = Array.isArray(report.targets) ? report.targets : [];
  return targets.filter((target) => matcher(target)).length;
}

function hasEvidence(target, label) {
  const evidence = Array.isArray(target?.evidence) ? target.evidence : [];
  const needle = normalizeText(label).toLowerCase();
  return evidence.some((entry) => normalizeText(entry).toLowerCase() === needle);
}

function isOpenCodeTarget(target = {}) {
  const haystack = `${normalizeText(target.repoName)} ${normalizeText(target.description)} ${normalizeText(target.username)}`.toLowerCase();
  return /\bopencode\b/.test(haystack);
}

function buildEvidenceSurfaces(links = buildRevenueLinks(), about = readGitHubAbout(), report = {}) {
  const openCodeTargetCount = countTargets(report, isOpenCodeTarget);
  const surfaces = [
    {
      key: 'repo_integration_guide',
      name: 'Repo-local OpenCode integration guide',
      url: OPENCODE_GUIDE_URL,
      supportUrl: OPENCODE_GUIDE_URL,
      evidenceSource: 'docs/guides/opencode-integration.md',
      operatorUse: 'Primary technical proof surface for repo-local OpenCode usage, worktree rules, and the read-only review subagent.',
      buyerSignal: 'OpenCode builders who want to inspect the exact repo-native setup before installing anything.',
    },
    {
      key: 'portable_install_profile',
      name: 'Portable OpenCode install profile',
      url: buildTrackedOpenCodeLink(OPENCODE_INSTALL_URL, {
        utmCampaign: 'opencode_install_profile',
        utmContent: 'install_doc',
        campaignVariant: 'portable_install',
        offerCode: 'OPENCODE-INSTALL_PROFILE',
        ctaId: 'opencode_install_profile',
        ctaPlacement: 'install_surface',
      }),
      supportUrl: OPENCODE_INSTALL_URL,
      evidenceSource: 'plugins/opencode-profile/INSTALL.md',
      operatorUse: 'Fastest path for OpenCode users who want a portable MCP profile outside this repo.',
      buyerSignal: 'Warm self-serve buyers ready to copy the profile if the local-first story and proof are explicit.',
    },
    {
      key: 'repo_config_surface',
      name: 'Repo-local opencode.json config',
      url: OPENCODE_CONFIG_URL,
      supportUrl: OPENCODE_GUIDE_URL,
      evidenceSource: 'opencode.json',
      operatorUse: 'Concrete config proof for worktree-safe defaults, denied destructive git commands, and local MCP wiring.',
      buyerSignal: 'Technical evaluators comparing generic OpenCode setup against a repo-backed, guardrail-aware config.',
    },
    {
      key: 'self_hosted_orchestrator_guide',
      name: 'Multica plus OpenCode self-hosted guide',
      url: buildTrackedOpenCodeLink(MULTICA_GUIDE_URL, {
        utmCampaign: 'opencode_multica_guide',
        utmContent: 'self_hosted',
        campaignVariant: 'scheduled_jobs',
        offerCode: 'OPENCODE-MULTICA_GUIDE',
        ctaId: 'opencode_multica_guide',
        ctaPlacement: 'guide_surface',
      }),
      supportUrl: MULTICA_GUIDE_SOURCE_URL,
      evidenceSource: 'public/guides/multica-thumbgate-setup.html',
      operatorUse: 'Use when an OpenCode buyer runs scheduled or self-hosted jobs and needs pre-action checks before autopilot drift repeats.',
      buyerSignal: `Self-hosted OpenCode or Multica users with recurring jobs, rollout risk, or proof needs. Current OpenCode-style targets: ${openCodeTargetCount}.`,
    },
    {
      key: 'proof_backed_setup_guide',
      name: 'Proof-backed setup guide',
      url: buildTrackedOpenCodeLink(GUIDE_URL, {
        utmCampaign: 'opencode_setup_guide',
        utmContent: 'guide',
        campaignVariant: 'proof_backed_setup',
        offerCode: 'OPENCODE-SETUP_GUIDE',
        ctaId: 'opencode_setup_guide',
        ctaPlacement: 'guide_surface',
      }),
      supportUrl: 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/public/guide.html',
      evidenceSource: 'public/guide.html',
      operatorUse: 'General conversion surface once the OpenCode buyer accepts the install path and wants proof plus pricing in one place.',
      buyerSignal: 'OpenCode users who want the shortest path from install interest to proof-backed checkout or sprint intake.',
    },
  ];

  return surfaces.map((surface) => ({
    ...surface,
    repositoryUrl: about.repositoryUrl,
    proofUrl: VERIFICATION_EVIDENCE_LINK,
    proofLinks: [...PROOF_LINKS],
    appOrigin: links.appOrigin,
  }));
}

function buildFollowOnOffers(links = buildRevenueLinks()) {
  return [
    {
      key: 'pro',
      label: 'ThumbGate Pro',
      pricing: links.proPriceLabel,
      buyer: 'Solo OpenCode operators who prove one blocked repeat and want dashboard plus export-ready evidence.',
      cta: buildTrackedOpenCodeLink(links.proCheckoutLink, {
        utmCampaign: 'opencode_pro_follow_on',
        utmContent: 'pro',
        campaignVariant: 'pro_follow_on',
        offerCode: 'OPENCODE-PRO_FOLLOW_ON',
        ctaId: 'opencode_pro_follow_on',
        ctaPlacement: 'post_install',
        planId: 'pro',
        surface: 'opencode_post_install',
      }),
    },
    {
      key: 'sprint',
      label: 'Workflow Hardening Sprint',
      pricing: 'Intake-led sprint, then Team at $49/seat/mo with 3-seat minimum after qualification',
      buyer: 'Teams running scheduled jobs, shared repos, or self-hosted OpenCode workflows that need approval boundaries and proof.',
      cta: buildTrackedOpenCodeLink(links.sprintLink, {
        utmCampaign: 'opencode_team_follow_on',
        utmContent: 'workflow_sprint',
        campaignVariant: 'self_hosted_team',
        offerCode: 'OPENCODE-TEAMS_FOLLOW_ON',
        ctaId: 'opencode_team_follow_on',
        ctaPlacement: 'post_install',
        surface: 'opencode_post_install',
      }),
    },
  ];
}

function buildListingCopy(links = buildRevenueLinks()) {
  const followOnOffers = buildFollowOnOffers(links);
  return {
    headline: CANONICAL_HEADLINE,
    subhead: 'ThumbGate adds a local MCP runtime, worktree-safe defaults, and proof-backed prevention rules for OpenCode workflows.',
    shortDescription: 'Local-first guardrails for OpenCode. Capture feedback, promote repeated failures into Pre-Action Checks, and keep proof close to the install path.',
    proofBullets: [
      'Repo-local opencode.json ships worktree-safe defaults and denies destructive git commands.',
      'Portable OpenCode install docs keep the MCP profile explicit and version-pinned.',
      'A read-only OpenCode review agent adds verification pressure without creating another edit-capable worker.',
    ],
    primaryCta: {
      label: 'Install OpenCode profile',
      url: buildTrackedOpenCodeLink(OPENCODE_INSTALL_URL, {
        utmCampaign: 'opencode_primary_install',
        utmContent: 'install_doc',
        campaignVariant: 'portable_install',
        offerCode: 'OPENCODE-PRIMARY_INSTALL',
        ctaId: 'opencode_primary_install',
        ctaPlacement: 'listing_copy',
      }),
    },
    secondaryCta: {
      label: 'Read OpenCode integration guide',
      url: OPENCODE_GUIDE_URL,
    },
    proofCta: {
      label: 'Verification evidence',
      url: VERIFICATION_EVIDENCE_LINK,
    },
    followOnOffers,
  };
}

function buildOperatorQueue(links = buildRevenueLinks(), report = {}) {
  const openCodeTargetCount = countTargets(report, isOpenCodeTarget);
  const selfServeTargetCount = countTargets(report, (target) => hasEvidence(target, 'self-serve agent tooling'));
  const productionTargetCount = countTargets(report, (target) => hasEvidence(target, 'production or platform workflow'));

  return [
    {
      key: 'portable_install_repeat',
      audience: 'OpenCode builder who wants the fastest local-first install path',
      evidence: `ThumbGate already ships a portable OpenCode install profile plus repo-local OpenCode docs. Current OpenCode-style targets: ${openCodeTargetCount}.`,
      proofTrigger: 'They can name one repeated tool, edit, or review mistake they want blocked before the next OpenCode session.',
      proofAsset: OPENCODE_INSTALL_URL,
      nextAsk: buildTrackedOpenCodeLink(OPENCODE_INSTALL_URL, {
        utmCampaign: 'opencode_queue_install',
        utmContent: 'install_doc',
        campaignVariant: 'portable_install',
        offerCode: 'OPENCODE-QUEUE_INSTALL',
        ctaId: 'opencode_queue_install',
        ctaPlacement: 'operator_queue',
      }),
      recommendedMotion: 'Portable install -> one blocked repeat -> Pro.',
    },
    {
      key: 'repo_rollout_guardrails',
      audience: 'Repo-backed OpenCode team that cares about worktree safety and review proof',
      evidence: `opencode.json plus the read-only review agent make the repo-backed rollout explicit. Current self-serve tooling targets: ${selfServeTargetCount}.`,
      proofTrigger: 'They want a repo-native config surface instead of ad hoc local notes or prompt-only guardrails.',
      proofAsset: OPENCODE_CONFIG_URL,
      nextAsk: buildTrackedOpenCodeLink(OPENCODE_GUIDE_URL, {
        utmCampaign: 'opencode_queue_repo_rollout',
        utmContent: 'integration_doc',
        campaignVariant: 'repo_rollout',
        offerCode: 'OPENCODE-QUEUE_REPO',
        ctaId: 'opencode_queue_repo',
        ctaPlacement: 'operator_queue',
      }),
      recommendedMotion: 'Integration guide -> repo rollout proof -> Workflow Hardening Sprint after one owner and workflow are named.',
    },
    {
      key: 'self_hosted_open_code_jobs',
      audience: 'Self-hosted OpenCode or Multica operator running recurring jobs',
      evidence: `The Multica guide positions ThumbGate as the pre-action layer for scheduled OpenCode jobs. Current production-style targets: ${productionTargetCount}.`,
      proofTrigger: 'They already run scheduled or self-hosted work where autopilot drift, rollback pain, or approval boundaries matter.',
      proofAsset: MULTICA_GUIDE_SOURCE_URL,
      nextAsk: buildTrackedOpenCodeLink(links.sprintLink, {
        utmMedium: OUTREACH_MEDIUM,
        utmCampaign: 'opencode_queue_sprint',
        utmContent: 'workflow_sprint',
        campaignVariant: 'self_hosted_open_code',
        offerCode: 'OPENCODE-QUEUE_SPRINT',
        ctaId: 'opencode_queue_sprint',
        ctaPlacement: 'operator_queue',
        surface: 'opencode_workflow_queue',
      }),
      recommendedMotion: 'Qualify one scheduled or self-hosted workflow for the Workflow Hardening Sprint.',
    },
  ];
}

function buildProspectQueue(report = {}) {
  const targets = Array.isArray(report.targets) ? report.targets : [];
  return targets
    .filter(isOpenCodeTarget)
    .map((target) => ({
      key: normalizeText(target.pipelineLeadId) || `${normalizeText(target.username)}_${normalizeText(target.repoName)}`.toLowerCase(),
      label: `@${normalizeText(target.username)} — ${normalizeText(target.repoName) || normalizeText(target.accountName) || 'OpenCode target'}`,
      pipelineLeadId: normalizeText(target.pipelineLeadId) || 'n/a',
      repoName: normalizeText(target.repoName),
      repoUrl: normalizeText(target.repoUrl),
      contactUrl: normalizeText(target.contactUrl),
      source: `${normalizeText(target.source)} / ${normalizeText(target.channel)}`,
      temperature: normalizeText(target.temperature),
      evidenceScore: Number.isFinite(target.evidenceScore) ? target.evidenceScore : 0,
      evidence: Array.isArray(target.evidence) ? target.evidence.join('; ') : '',
      motionLabel: normalizeText(target.motionLabel),
      motionReason: normalizeText(target.motionReason),
      cta: normalizeText(target.cta),
      proofPackTrigger: normalizeText(target.proofPackTrigger),
      firstTouchDraft: normalizeText(target.firstTouchDraft),
      painConfirmedFollowUpDraft: normalizeText(target.painConfirmedFollowUpDraft),
      markContactedCommand: normalizeText(target.salesCommands?.markContacted),
    }));
}

function buildOutreachDrafts(links = buildRevenueLinks()) {
  const installLink = buildTrackedOpenCodeLink(OPENCODE_INSTALL_URL, {
    utmMedium: OUTREACH_MEDIUM,
    utmCampaign: 'opencode_outreach_install',
    utmContent: 'install_doc',
    campaignVariant: 'self_serve_first',
    offerCode: 'OPENCODE-OUTREACH_INSTALL',
    ctaId: 'opencode_outreach_install',
    ctaPlacement: 'outreach_draft',
    surface: 'opencode_outreach',
  });
  const proLink = buildTrackedOpenCodeLink(links.proCheckoutLink, {
    utmMedium: OUTREACH_MEDIUM,
    utmCampaign: 'opencode_outreach_pro',
    utmContent: 'pro',
    campaignVariant: 'proof_after_repeat',
    offerCode: 'OPENCODE-OUTREACH_PRO',
    ctaId: 'opencode_outreach_pro',
    ctaPlacement: 'outreach_draft',
    planId: 'pro',
    surface: 'opencode_outreach',
  });
  const sprintLink = buildTrackedOpenCodeLink(links.sprintLink, {
    utmMedium: OUTREACH_MEDIUM,
    utmCampaign: 'opencode_outreach_sprint',
    utmContent: 'workflow_sprint',
    campaignVariant: 'self_hosted_jobs',
    offerCode: 'OPENCODE-OUTREACH_SPRINT',
    ctaId: 'opencode_outreach_sprint',
    ctaPlacement: 'outreach_draft',
    surface: 'opencode_outreach',
  });

  return [
    {
      key: 'self_serve_first',
      channel: 'GitHub DM or email',
      audience: 'OpenCode plugin or hook maintainer',
      draft: `If OpenCode is already part of the workflow, the missing piece is not another note in chat. It is a local-first install path that can turn one repeated mistake into a Pre-Action Check before the next tool call or edit runs. The shortest operator path is here: ${installLink} .`,
    },
    {
      key: 'proof_after_repeat',
      channel: 'Pain-confirmed follow-up',
      audience: 'Solo OpenCode operator who already named one repeated failure',
      draft: `Once the repeated failure is concrete, move from install curiosity to proof plus the paid operator path. Use Verification Evidence first, then route the buyer to Pro only if they want dashboard and export-ready evidence: ${VERIFICATION_EVIDENCE_LINK} then ${proLink} .`,
    },
    {
      key: 'self_hosted_jobs',
      channel: 'Founder note',
      audience: 'Self-hosted OpenCode or Multica workflow owner',
      draft: `If OpenCode is already running as a scheduled or self-hosted job, the real question is what stops the same risky action from firing again tomorrow. ThumbGate is the lane for that. If one workflow already has autopilot drift, rollback pressure, or approval-boundary pain, route it to the Workflow Hardening Sprint: ${sprintLink} .`,
    },
  ];
}

function buildMeasurementPlan() {
  return {
    northStar: 'opencode_install_to_paid_intent',
    policy: 'Treat OpenCode install interest as acquisition evidence only after a tracked proof click, Pro checkout start, or qualified sprint conversation exists.',
    metrics: [
      'opencode_install_doc_clicks',
      'opencode_integration_doc_views',
      'opencode_setup_guide_clicks',
      'opencode_proof_clicks',
      'opencode_pro_checkout_starts',
      'opencode_qualified_team_conversations',
    ],
    guardrails: [
      'Do not claim installs, revenue, or marketplace approval without direct command evidence.',
      'Do not lead first-touch outreach with proof links before the buyer confirms pain.',
      'Keep pricing aligned with COMMERCIAL_TRUTH.md.',
      'Keep proof claims aligned with VERIFICATION_EVIDENCE.md.',
    ],
  };
}

function buildPackSummary(report = {}) {
  const openCodeTargetCount = countTargets(report, isOpenCodeTarget);
  const directiveHeadline = normalizeText(report?.directive?.headline);
  return [
    `OpenCode should stay self-serve-first until one repeated failure is concrete, then escalate to Pro or a workflow sprint with proof. Current OpenCode-style targets: ${openCodeTargetCount}.`,
    directiveHeadline || 'No verified revenue and no active pipeline. Use OpenCode install and self-hosted workflow surfaces to create proof-backed paid intent.',
  ].join(' ');
}

function buildOpenCodeRevenuePack(report = {}, links = buildRevenueLinks(), about = readGitHubAbout()) {
  return {
    generatedAt: normalizeText(report.generatedAt) || new Date().toISOString(),
    state: normalizeText(report?.directive?.state) || 'cold-start',
    objective: 'Turn OpenCode install interest and self-hosted workflow risk into tracked proof clicks, Pro checkout starts, and qualified workflow-hardening conversations.',
    headline: CANONICAL_HEADLINE,
    shortDescription: CANONICAL_SHORT_DESCRIPTION,
    summary: buildPackSummary(report),
    canonicalIdentity: {
      displayName: 'ThumbGate for OpenCode',
      repositoryUrl: about.repositoryUrl,
      homepageUrl: about.homepageUrl,
      integrationGuideUrl: OPENCODE_GUIDE_URL,
      installUrl: OPENCODE_INSTALL_URL,
      commercialTruthUrl: COMMERCIAL_TRUTH_LINK,
      verificationEvidenceUrl: VERIFICATION_EVIDENCE_LINK,
    },
    evidenceSurfaces: buildEvidenceSurfaces(links, about, report),
    listingCopy: buildListingCopy(links),
    operatorQueue: buildOperatorQueue(links, report),
    prospectQueue: buildProspectQueue(report),
    outreachDrafts: buildOutreachDrafts(links),
    measurementPlan: buildMeasurementPlan(),
    proofLinks: [...PROOF_LINKS],
  };
}

function renderNamedSection(name, lines) {
  return [name, ...lines, ''];
}

function renderOpenCodeRevenuePackMarkdown(pack = {}) {
  const surfaceLines = Array.isArray(pack.evidenceSurfaces) && pack.evidenceSurfaces.length
    ? pack.evidenceSurfaces.flatMap((surface) => renderNamedSection(`### ${surface.name}`, [
      `- URL: ${surface.url}`,
      `- Operator use: ${surface.operatorUse}`,
      `- Buyer signal: ${surface.buyerSignal}`,
      `- Evidence source: ${surface.evidenceSource}`,
      `- Proof: ${surface.proofUrl}`,
      `- Support: ${surface.supportUrl}`,
      `- Proof links: ${surface.proofLinks.join(' | ')}`,
    ]))
    : ['- No OpenCode surfaces available.', ''];
  const queueLines = Array.isArray(pack.operatorQueue) && pack.operatorQueue.length
    ? pack.operatorQueue.flatMap((entry) => renderNamedSection(`### ${entry.audience}`, [
      `- Evidence: ${entry.evidence}`,
      `- Proof trigger: ${entry.proofTrigger}`,
      `- Proof asset: ${entry.proofAsset}`,
      `- Next ask: ${entry.nextAsk}`,
      `- Recommended motion: ${entry.recommendedMotion}`,
    ]))
    : ['- No operator queue entries available.', ''];
  const prospectLines = Array.isArray(pack.prospectQueue) && pack.prospectQueue.length
    ? pack.prospectQueue.flatMap((entry) => renderNamedSection(`### ${entry.label}`, [
      `- Source: ${entry.source}`,
      `- Temperature: ${entry.temperature}`,
      `- Evidence score: ${entry.evidenceScore}`,
      `- Evidence: ${entry.evidence}`,
      `- Motion: ${entry.motionLabel}`,
      `- Why now: ${entry.motionReason}`,
      `- CTA: ${entry.cta}`,
      `- Pipeline lead id: ${entry.pipelineLeadId}`,
      `- First-touch draft: ${entry.firstTouchDraft}`,
      `- Log after send: ${entry.markContactedCommand || 'n/a'}`,
    ]))
    : ['- No OpenCode-specific prospects are currently in the revenue loop.', ''];
  const outreachLines = Array.isArray(pack.outreachDrafts) && pack.outreachDrafts.length
    ? pack.outreachDrafts.flatMap((entry) => renderNamedSection(`### ${entry.channel} — ${entry.audience}`, [
      '',
      entry.draft,
    ]))
    : ['- No outreach drafts available.', ''];

  return [
    '# OpenCode Revenue Pack',
    '',
    `Updated: ${pack.generatedAt}`,
    '',
    'This is a sales operator artifact. It is not proof of installs, revenue, or marketplace approval by itself.',
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
    `- Display name: ${pack.canonicalIdentity?.displayName || ''}`,
    `- Repository: ${pack.canonicalIdentity?.repositoryUrl || ''}`,
    `- Homepage: ${pack.canonicalIdentity?.homepageUrl || ''}`,
    `- Integration guide: ${pack.canonicalIdentity?.integrationGuideUrl || ''}`,
    `- Install docs: ${pack.canonicalIdentity?.installUrl || ''}`,
    '',
    '## Verified OpenCode Surfaces',
    ...surfaceLines,
    '## Listing Copy',
    `- Headline: ${pack.listingCopy?.headline || ''}`,
    `- Subhead: ${pack.listingCopy?.subhead || ''}`,
    `- Short description: ${pack.listingCopy?.shortDescription || ''}`,
    '- Proof bullets:',
    ...((pack.listingCopy?.proofBullets || []).map((bullet) => `  - ${bullet}`)),
    `- Primary CTA: ${pack.listingCopy?.primaryCta?.label || ''} — ${pack.listingCopy?.primaryCta?.url || ''}`,
    `- Secondary CTA: ${pack.listingCopy?.secondaryCta?.label || ''} — ${pack.listingCopy?.secondaryCta?.url || ''}`,
    `- Proof CTA: ${pack.listingCopy?.proofCta?.label || ''} — ${pack.listingCopy?.proofCta?.url || ''}`,
    '- Follow-on offers:',
    ...((pack.listingCopy?.followOnOffers || []).map((offer) => `  - ${offer.label} (${offer.pricing}) -> ${offer.cta}`)),
    '',
    '## Operator Queue',
    ...queueLines,
    '## Prospect Queue',
    ...prospectLines,
    '## Outreach Drafts',
    ...outreachLines,
    '## Measurement Guardrails',
    `- North star: ${pack.measurementPlan?.northStar || 'n/a'}`,
    `- Policy: ${pack.measurementPlan?.policy || 'n/a'}`,
    '- Tracked metrics:',
    ...((pack.measurementPlan?.metrics || []).map((metric) => `  - ${metric}`)),
    '- Guardrails:',
    ...((pack.measurementPlan?.guardrails || []).map((guardrail) => `  - ${guardrail}`)),
    '',
    '## Proof Links',
    ...((pack.proofLinks || []).map((link) => `- ${link}`)),
    '',
  ].join('\n');
}

function renderOpenCodeProspectQueueCsv(pack = {}) {
  const prospects = Array.isArray(pack.prospectQueue) ? pack.prospectQueue : [];
  const rows = [
    ['key', 'label', 'pipelineLeadId', 'source', 'temperature', 'repoName', 'repoUrl', 'evidenceScore', 'evidence', 'motionLabel', 'cta', 'proofPackTrigger', 'firstTouchDraft', 'markContactedCommand'],
    ...prospects.map((entry) => ([
      entry.key,
      entry.label,
      entry.pipelineLeadId,
      entry.source,
      entry.temperature,
      entry.repoName,
      entry.repoUrl,
      String(entry.evidenceScore),
      entry.evidence,
      entry.motionLabel,
      entry.cta,
      entry.proofPackTrigger,
      entry.firstTouchDraft,
      entry.markContactedCommand,
    ])),
  ];

  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function writeOpenCodeRevenuePack(pack, options = {}) {
  return writeRevenuePackArtifacts({
    repoRoot: REPO_ROOT,
    reportDir: options.reportDir,
    writeDocs: options.writeDocs,
    docsPath: path.join(REPO_ROOT, 'docs', 'marketing', 'opencode-revenue-pack.md'),
    markdown: renderOpenCodeRevenuePackMarkdown(pack),
    jsonName: 'opencode-revenue-pack.json',
    jsonValue: pack,
    csvArtifacts: [
      {
        name: 'opencode-operator-queue.csv',
        value: renderOperatorQueueCsv(pack.operatorQueue),
      },
      {
        name: 'opencode-prospect-queue.csv',
        value: renderOpenCodeProspectQueueCsv(pack),
      },
    ],
  });
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const pack = buildOpenCodeRevenuePack(readRevenueLoopReport());
  const written = writeOpenCodeRevenuePack(pack, options);

  console.log('OpenCode revenue pack ready.');
  if (written.docsPath) {
    console.log(`Docs updated: ${written.docsPath}`);
  }
  if (written.reportDir) {
    console.log(`Artifacts written to ${written.reportDir}`);
  }
  console.log(JSON.stringify({
    surfaces: pack.evidenceSurfaces.length,
    operatorQueue: pack.operatorQueue.length,
    prospectQueue: pack.prospectQueue.length,
    northStar: pack.measurementPlan.northStar,
  }, null, 2));
}

function parseArgs(argv = []) {
  return parseReportArgs(argv);
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
  MULTICA_GUIDE_URL,
  OPENCODE_GUIDE_URL,
  OPENCODE_INSTALL_URL,
  buildEvidenceSurfaces,
  buildFollowOnOffers,
  buildListingCopy,
  buildMeasurementPlan,
  buildOpenCodeRevenuePack,
  buildOperatorQueue,
  buildOutreachDrafts,
  buildProspectQueue,
  buildTrackedOpenCodeLink,
  isCliInvocation,
  parseArgs,
  readRevenueLoopReport,
  renderOpenCodeProspectQueueCsv,
  renderOpenCodeRevenuePackMarkdown,
  writeOpenCodeRevenuePack,
};
