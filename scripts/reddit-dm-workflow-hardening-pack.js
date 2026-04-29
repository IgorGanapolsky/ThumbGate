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
  buildRevenueEvidenceContext,
  buildTrackedPackLink,
  csvCell,
  isCliInvocation: isCliCall,
  normalizeText,
  parseReportArgs,
  readGitHubAbout,
  writeRevenuePackArtifacts,
} = require('./revenue-pack-utils');

const REPO_ROOT = path.resolve(__dirname, '..');
const REVENUE_LOOP_REPORT_PATH = path.join(REPO_ROOT, 'docs', 'marketing', 'gtm-revenue-loop.json');
const DOCS_PATH = path.join(REPO_ROOT, 'docs', 'marketing', 'reddit-dm-workflow-hardening-pack.md');
const JSON_NAME = 'reddit-dm-workflow-hardening-pack.json';
const QUEUE_CSV_NAME = 'reddit-dm-operator-queue.csv';
const DRAFTS_CSV_NAME = 'reddit-dm-drafts.csv';
const GUIDE_URL = 'https://thumbgate-production.up.railway.app/guide';
const TRACKING_DEFAULTS = {
  utmSource: 'reddit',
  utmMedium: 'reddit_dm',
  utmCampaign: 'reddit_workflow_hardening',
  utmContent: 'warm_outreach',
  surface: 'reddit_dm_workflow_hardening',
};
const CANONICAL_HEADLINE = 'Turn warm Reddit workflow-risk conversations into sprint-qualified paid intent.';
const CANONICAL_SHORT_DESCRIPTION = 'ThumbGate gives warm Reddit DM outreach one honest offer: harden one AI-agent workflow with rollback safety, approval boundaries, and proof after pain is confirmed.';
const CANONICAL_FIELDS = [
  { label: 'Display name', key: 'displayName', fallback: 'ThumbGate' },
  { label: 'Repository', key: 'repositoryUrl' },
  { label: 'Homepage', key: 'homepageUrl' },
  { label: 'Commercial truth', key: 'commercialTruthUrl' },
  { label: 'Verification evidence', key: 'verificationEvidenceUrl' },
];
const PROOF_LINKS = [COMMERCIAL_TRUTH_LINK, VERIFICATION_EVIDENCE_LINK];

function buildTrackedRedditLink(baseUrl, tracking = {}) {
  return buildTrackedPackLink(baseUrl, tracking, TRACKING_DEFAULTS);
}

function readRevenueLoopReport(reportPath = REVENUE_LOOP_REPORT_PATH) {
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch {
    return {};
  }
}

function getWarmRedditTargets(report = {}) {
  const targets = Array.isArray(report.targets) ? report.targets : [];
  return targets
    .filter((target) => normalizeText(target.temperature).toLowerCase() === 'warm')
    .filter((target) => normalizeText(target.source).toLowerCase() === 'reddit')
    .filter((target) => normalizeText(target.channel).toLowerCase() === 'reddit_dm')
    .sort((left, right) => {
      const scoreDiff = Number(right.evidenceScore || 0) - Number(left.evidenceScore || 0);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      return normalizeText(left.username).localeCompare(normalizeText(right.username));
    });
}

function hasEvidence(target = {}, label = '') {
  const evidence = Array.isArray(target.evidence) ? target.evidence : [];
  const needle = normalizeText(label).toLowerCase();
  return evidence.some((entry) => normalizeText(entry).toLowerCase() === needle);
}

function collectPainSignals(report = {}) {
  const targets = getWarmRedditTargets(report);
  const seen = new Set();
  const signals = [];
  const prefix = 'workflow pain named:';

  for (const target of targets) {
    const evidence = Array.isArray(target.evidence) ? target.evidence : [];
    for (const entry of evidence) {
      const normalized = normalizeText(entry);
      if (!normalized.toLowerCase().startsWith(prefix)) {
        continue;
      }
      const signal = normalized.slice(prefix.length).trim().replace(/\.$/, '');
      const key = signal.toLowerCase();
      if (!signal || seen.has(key)) {
        continue;
      }
      seen.add(key);
      signals.push(signal);
    }
  }

  return signals;
}

function formatPainSignals(report = {}) {
  const signals = collectPainSignals(report);
  if (!signals.length) {
    return 'repeated workflow failures';
  }
  if (signals.length === 1) {
    return signals[0];
  }
  return `${signals.slice(0, -1).join(', ')}, and ${signals.at(-1)}`;
}

function buildEvidenceBackstop(report = {}) {
  const targets = getWarmRedditTargets(report);
  const subreddits = [...new Set(targets
    .map((target) => normalizeText(target.accountName))
    .filter(Boolean))];

  return {
    warmTargetCount: targets.length,
    alreadyInDmCount: targets.filter((target) => hasEvidence(target, 'already in DMs')).length,
    subredditCount: subreddits.length,
    subreddits,
    namedPainSignals: collectPainSignals(report),
  };
}

function buildCanonicalIdentity(about = readGitHubAbout()) {
  return {
    displayName: 'ThumbGate',
    repositoryUrl: about.repositoryUrl,
    homepageUrl: about.homepageUrl,
    commercialTruthUrl: COMMERCIAL_TRUTH_LINK,
    verificationEvidenceUrl: VERIFICATION_EVIDENCE_LINK,
  };
}

function buildEvidenceSurfaces(links = buildRevenueLinks(), about = readGitHubAbout()) {
  return [
    {
      name: 'Workflow Hardening Sprint intake',
      url: buildTrackedRedditLink(links.sprintLink, {
        utmCampaign: 'reddit_sprint_intake',
        utmContent: 'workflow_sprint',
        campaignVariant: 'pain_confirmed',
        offerCode: 'REDDIT-SPRINT_INTAKE',
        ctaId: 'reddit_sprint_intake',
        ctaPlacement: 'pack_surface',
        surface: 'reddit_dm_sprint',
      }),
      operatorUse: 'Primary CTA after the buyer confirms one repeated workflow failure worth a 15-minute diagnostic.',
      buyerSignal: 'Warm Reddit engager who already described a real workflow risk and wants help fixing it.',
    },
    {
      name: 'Proof-backed setup guide',
      url: buildTrackedRedditLink(GUIDE_URL, {
        utmCampaign: 'reddit_setup_guide',
        utmContent: 'guide',
        campaignVariant: 'self_serve_interest',
        offerCode: 'REDDIT-SETUP_GUIDE',
        ctaId: 'reddit_setup_guide',
        ctaPlacement: 'pack_surface',
      }),
      operatorUse: 'Use only when the buyer asks for the tool path before they are ready for a sprint conversation.',
      buyerSignal: 'Warm builder who wants to inspect the install path before committing to a deeper diagnostic.',
    },
    {
      name: 'Verification evidence',
      url: VERIFICATION_EVIDENCE_LINK,
      operatorUse: 'Send only after pain is confirmed and the buyer asks for proof or rollout evidence.',
      buyerSignal: 'Pain-confirmed buyer who asks how ThumbGate proves quality before a sprint or checkout.',
    },
  ].map((surface) => ({
    ...surface,
    repositoryUrl: about.repositoryUrl,
    proofLinks: [...PROOF_LINKS],
  }));
}

function buildFollowOnOffers(links = buildRevenueLinks()) {
  return [
    {
      label: 'Workflow Hardening Sprint',
      pricing: 'Discovery-led sprint, then Team at $49/seat/mo with a 3-seat minimum after qualification',
      buyer: 'Warm buyers who already named a repeated workflow failure and want one proof-backed fix loop.',
      cta: buildTrackedRedditLink(links.sprintLink, {
        utmCampaign: 'reddit_follow_on_sprint',
        utmContent: 'workflow_sprint',
        campaignVariant: 'team_follow_on',
        offerCode: 'REDDIT-FOLLOW_ON_SPRINT',
        ctaId: 'reddit_follow_on_sprint',
        ctaPlacement: 'post_reply',
        surface: 'reddit_dm_follow_on',
      }),
    },
    {
      label: 'ThumbGate Pro',
      pricing: links.proPriceLabel,
      buyer: 'Warm solo operators who asked for the self-serve path after the workflow discussion.',
      cta: buildTrackedRedditLink(links.proCheckoutLink, {
        utmCampaign: 'reddit_follow_on_pro',
        utmContent: 'pro',
        campaignVariant: 'solo_follow_on',
        offerCode: 'REDDIT-FOLLOW_ON_PRO',
        ctaId: 'reddit_follow_on_pro',
        ctaPlacement: 'post_reply',
        planId: 'pro',
        surface: 'reddit_dm_follow_on',
      }),
    },
  ];
}

function buildOperatorQueue(links = buildRevenueLinks(), report = {}) {
  return getWarmRedditTargets(report).map((target) => {
    const username = normalizeText(target.username);
    const audience = `u/${username} — ${normalizeText(target.accountName) || 'Reddit DM'}`;
    const evidence = Array.isArray(target.evidence) ? target.evidence.filter(Boolean) : [];
    const nextAsk = normalizeText(target.nextOperatorAction || target.salesCommands?.markContacted);

    return {
      key: normalizeText(target.pipelineLeadId || username.toLowerCase()),
      audience,
      evidence: `${evidence.join(', ')}. Angle: ${normalizeText(target.outreachAngle)}`,
      proofTrigger: normalizeText(target.proofPackTrigger) || 'Use proof links only after the buyer confirms pain.',
      proofAsset: `Commercial truth: ${COMMERCIAL_TRUTH_LINK} | Verification evidence: ${VERIFICATION_EVIDENCE_LINK}`,
      nextAsk,
      recommendedMotion: `${normalizeText(target.motionLabel) || 'Workflow Hardening Sprint'} -> pain-confirmed proof -> diagnostic`,
      subject: normalizeText(target.subject) || 'Workflow hardening diagnostic',
      contactUrl: normalizeText(target.contactUrl),
      firstTouchDraft: normalizeText(target.firstTouchDraft || target.message),
      painConfirmedFollowUpDraft: normalizeText(target.painConfirmedFollowUpDraft),
      selfServeFollowUpDraft: normalizeText(target.selfServeFollowUpDraft),
      checkoutCloseDraft: normalizeText(target.checkoutCloseDraft),
      trackAfterSend: normalizeText(target.salesCommands?.markContacted),
    };
  });
}

function buildOutreachDrafts(report = {}) {
  return getWarmRedditTargets(report).map((target) => {
    const username = normalizeText(target.username);
    return {
      key: normalizeText(target.pipelineLeadId || username.toLowerCase()),
      channel: `Reddit DM -> u/${username}`,
      audience: normalizeText(target.accountName) || 'Warm workflow-risk lead',
      subject: normalizeText(target.subject) || 'Workflow hardening diagnostic',
      contactUrl: normalizeText(target.contactUrl),
      firstTouchDraft: normalizeText(target.firstTouchDraft || target.message),
      painConfirmedFollowUpDraft: normalizeText(target.painConfirmedFollowUpDraft),
      selfServeFollowUpDraft: normalizeText(target.selfServeFollowUpDraft),
      checkoutCloseDraft: normalizeText(target.checkoutCloseDraft),
      trackAfterSend: normalizeText(target.salesCommands?.markContacted),
      draft: [
        `Subject: ${normalizeText(target.subject) || 'Workflow hardening diagnostic'}`,
        '',
        normalizeText(target.firstTouchDraft || target.message),
        '',
        `Pain-confirmed follow-up: ${normalizeText(target.painConfirmedFollowUpDraft)}`,
        `Self-serve follow-up: ${normalizeText(target.selfServeFollowUpDraft)}`,
        `Checkout close draft: ${normalizeText(target.checkoutCloseDraft)}`,
        `Track after send: ${normalizeText(target.salesCommands?.markContacted)}`,
      ].join('\n'),
    };
  });
}

function buildMeasurementPlan() {
  return {
    northStar: 'reddit_warm_dm_to_paid_intent',
    policy: 'Warm Reddit discovery first, proof only after pain confirmation, no fake revenue or install claims.',
    minimumUsefulSignal: 'One warm Reddit lead moves from targeted to replied with a named workflow failure.',
    strongSignal: 'One warm Reddit lead books a diagnostic or enters sprint intake.',
    metrics: [
      'Warm Reddit DMs sent',
      'Warm Reddit replies',
      'Pain-confirmed replies',
      'Diagnostics booked',
      'Sprint intakes started',
      'Paid conversions sourced from Reddit DM',
    ],
    guardrails: [
      'Do not claim revenue, installs, or marketplace approval without direct command evidence.',
      'Do not send proof links before the buyer confirms pain.',
      'Keep pricing and traction language aligned with COMMERCIAL_TRUTH.md.',
      'Keep quality and proof language aligned with VERIFICATION_EVIDENCE.md.',
    ],
    milestones: [
      {
        window: 'Days 1-30',
        goal: 'Turn the existing warm Reddit queue into replied conversations with named workflow pain.',
        decisionRule: 'If no warm replies arrive, refresh the queue and tighten the first-touch offer instead of widening channels.',
      },
      {
        window: 'Days 31-60',
        goal: 'Book diagnostics or sprint intakes from the warm Reddit lane.',
        decisionRule: 'If replies arrive but no diagnostics book, rewrite the follow-up and CTA sequence using the buyer language collected.',
      },
      {
        window: 'Days 61-90',
        goal: 'Convert the first warm Reddit workflow into paid revenue or a qualified sprint.',
        decisionRule: 'If diagnostic demand exists without paid conversion, adjust offer framing before scaling the channel.',
      },
    ],
    doNotCountAsSuccess: [
      'Upvotes or replies without pipeline movement',
      'Proof-link clicks without pain confirmation',
      'Generic praise that never reaches contacted, replied, or booked stages',
    ],
  };
}

function buildRedditDmWorkflowHardeningPack(report = readRevenueLoopReport()) {
  const about = readGitHubAbout();
  const links = buildRevenueLinks();
  const evidenceBackstop = buildEvidenceBackstop(report);

  return {
    generatedAt: normalizeText(report.generatedAt) || new Date().toISOString(),
    objective: 'Convert the current warm Reddit workflow-risk queue into replied conversations, diagnostics, and the first paid Workflow Hardening Sprint.',
    state: normalizeText(report.directive?.state) || 'cold-start',
    headline: CANONICAL_HEADLINE,
    shortDescription: CANONICAL_SHORT_DESCRIPTION,
    summary: normalizeText(report.directive?.headline) || 'No verified revenue and no active pipeline.',
    revenueEvidence: buildRevenueEvidenceContext(report),
    canonicalIdentity: buildCanonicalIdentity(about),
    evidenceBackstop,
    surfaces: buildEvidenceSurfaces(links, about),
    followOnOffers: buildFollowOnOffers(links),
    operatorQueue: buildOperatorQueue(links, report),
    outreachDrafts: buildOutreachDrafts(report),
    measurementPlan: buildMeasurementPlan(),
    proofLinks: [...PROOF_LINKS],
  };
}

function renderFieldLines(fields = [], source = {}) {
  return fields.flatMap(({ label, key, fallback }) => {
    const resolved = normalizeText(source?.[key]);
    if (!resolved && fallback === undefined) {
      return [];
    }
    return [`- ${label}: ${resolved || fallback}`];
  });
}

function renderEvidenceSurfaces(surfaces = []) {
  if (!surfaces.length) {
    return ['- No evidence surfaces available.', ''];
  }

  return surfaces.flatMap((surface) => ([
    `### ${surface.name}`,
    `- URL: ${surface.url}`,
    `- Operator use: ${surface.operatorUse}`,
    `- Buyer signal: ${surface.buyerSignal}`,
    '',
  ]));
}

function renderQueueLines(queue = []) {
  if (!queue.length) {
    return ['- No warm Reddit targets are currently ready.', ''];
  }

  return queue.flatMap((entry) => ([
    `### ${entry.audience}`,
    `- Evidence: ${entry.evidence}`,
    `- Proof trigger: ${entry.proofTrigger}`,
    `- Proof asset: ${entry.proofAsset}`,
    `- Next ask: ${entry.nextAsk}`,
    `- Recommended motion: ${entry.recommendedMotion}`,
    `- Contact surface: ${entry.contactUrl || 'n/a'}`,
    '',
  ]));
}

function renderDraftLines(drafts = []) {
  if (!drafts.length) {
    return ['- No Reddit DM drafts are currently ready.', ''];
  }

  return drafts.flatMap((draft) => ([
    `### ${draft.channel} — ${draft.audience}`,
    draft.draft,
    '',
  ]));
}

function renderOfferLines(offers = []) {
  if (!offers.length) {
    return ['- No follow-on offers available.', ''];
  }

  return offers.flatMap((offer) => ([
    `- ${offer.label}: ${offer.pricing}`,
    `  Buyer: ${offer.buyer}`,
    `  CTA: ${offer.cta}`,
  ]));
}

function renderListLines(values = [], emptyLine = '- n/a') {
  if (!values.length) {
    return [emptyLine];
  }
  return values.map((value) => `- ${value}`);
}

function renderRedditDmWorkflowHardeningPackMarkdown(pack = {}) {
  return [
    '# Reddit DM Workflow Hardening Pack',
    '',
    `Updated: ${pack.generatedAt}`,
    '',
    'This pack turns the current warm Reddit workflow-risk queue into an operator-ready send surface. It is evidence-backed acquisition support, not proof of sent outreach or paid revenue.',
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
    '## Revenue Evidence',
    `- Billing source: ${normalizeText(pack.revenueEvidence?.source) || 'local'}`,
    `- Billing verification: ${normalizeText(pack.revenueEvidence?.label) || 'Current run is using local billing context.'}`,
    ...(normalizeText(pack.revenueEvidence?.fallbackReason)
      ? [`- Fallback reason: ${normalizeText(pack.revenueEvidence.fallbackReason)}`, '']
      : ['']),
    '## Canonical Identity',
    ...renderFieldLines(CANONICAL_FIELDS, pack.canonicalIdentity),
    '',
    '## Evidence Backstop',
    `- Warm Reddit targets: ${pack.evidenceBackstop?.warmTargetCount || 0}`,
    `- Already in DMs: ${pack.evidenceBackstop?.alreadyInDmCount || 0}`,
    `- Subreddits represented: ${pack.evidenceBackstop?.subredditCount || 0}`,
    `- Named pain signals: ${Array.isArray(pack.evidenceBackstop?.namedPainSignals) && pack.evidenceBackstop.namedPainSignals.length
      ? pack.evidenceBackstop.namedPainSignals.join(', ')
      : 'repeated workflow failures'}`,
    ...renderListLines(
      Array.isArray(pack.evidenceBackstop?.subreddits)
        ? pack.evidenceBackstop.subreddits.map((subreddit) => `Subreddit: ${subreddit}`)
        : [],
      '- Subreddit: n/a'
    ),
    ...renderListLines(
      Array.isArray(pack.evidenceBackstop?.namedPainSignals)
        ? pack.evidenceBackstop.namedPainSignals.map((signal) => `Pain signal: ${signal}`)
        : [],
      '- Pain signal: n/a'
    ),
    '',
    '## Demand Surfaces',
    ...renderEvidenceSurfaces(Array.isArray(pack.surfaces) ? pack.surfaces : []),
    '## Follow-On Offers',
    ...renderOfferLines(Array.isArray(pack.followOnOffers) ? pack.followOnOffers : []),
    '',
    '## Operator Queue',
    ...renderQueueLines(Array.isArray(pack.operatorQueue) ? pack.operatorQueue : []),
    '## Active DM Drafts',
    ...renderDraftLines(Array.isArray(pack.outreachDrafts) ? pack.outreachDrafts : []),
    '## 90-Day Measurement Plan',
    `- North star: ${pack.measurementPlan?.northStar || 'n/a'}`,
    `- Policy: ${pack.measurementPlan?.policy || 'n/a'}`,
    `- Minimum useful signal: ${pack.measurementPlan?.minimumUsefulSignal || 'n/a'}`,
    `- Strong signal: ${pack.measurementPlan?.strongSignal || 'n/a'}`,
    'Tracked metrics:',
    ...renderListLines(pack.measurementPlan?.metrics || []),
    'Guardrails:',
    ...renderListLines(pack.measurementPlan?.guardrails || []),
    'Milestones:',
    ...renderListLines(
      Array.isArray(pack.measurementPlan?.milestones)
        ? pack.measurementPlan.milestones.map((milestone) => `${milestone.window}: ${milestone.goal} Decision rule: ${milestone.decisionRule}`)
        : [],
      '- n/a'
    ),
    'Do not count as success:',
    ...renderListLines(pack.measurementPlan?.doNotCountAsSuccess || []),
    '',
    '## Proof Links',
    ...renderListLines(pack.proofLinks || [], '- No proof links available.'),
    '',
  ].join('\n');
}

function renderOperatorQueueCsv(queue = []) {
  const rows = [
    ['key', 'audience', 'contact_url', 'evidence', 'proof_trigger', 'next_ask', 'recommended_motion', 'track_after_send'],
    ...queue.map((entry) => ([
      entry.key,
      entry.audience,
      entry.contactUrl,
      entry.evidence,
      entry.proofTrigger,
      entry.nextAsk,
      entry.recommendedMotion,
      entry.trackAfterSend,
    ])),
  ];

  return `${rows.map((row) => row.map((cell) => csvCell(cell)).join(',')).join('\n')}\n`;
}

function renderDraftsCsv(drafts = []) {
  const rows = [
    ['channel', 'audience', 'subject', 'contact_url', 'first_touch', 'pain_confirmed_follow_up', 'self_serve_follow_up', 'checkout_close', 'track_after_send'],
    ...drafts.map((draft) => ([
      draft.channel,
      draft.audience,
      normalizeText(draft.subject),
      normalizeText(draft.contactUrl),
      normalizeText(draft.firstTouchDraft),
      normalizeText(draft.painConfirmedFollowUpDraft),
      normalizeText(draft.selfServeFollowUpDraft),
      normalizeText(draft.checkoutCloseDraft),
      normalizeText(draft.trackAfterSend),
    ])),
  ];

  return `${rows.map((row) => row.map((cell) => csvCell(cell)).join(',')).join('\n')}\n`;
}

function writeRedditDmWorkflowHardeningPack(pack, options = {}) {
  return writeRevenuePackArtifacts({
    repoRoot: REPO_ROOT,
    reportDir: options.reportDir,
    writeDocs: options.writeDocs,
    docsPath: DOCS_PATH,
    markdown: renderRedditDmWorkflowHardeningPackMarkdown(pack),
    jsonName: JSON_NAME,
    jsonValue: pack,
    csvArtifacts: [
      {
        name: QUEUE_CSV_NAME,
        value: renderOperatorQueueCsv(pack.operatorQueue),
      },
      {
        name: DRAFTS_CSV_NAME,
        value: renderDraftsCsv(pack.outreachDrafts),
      },
    ],
  });
}

function main(argv = process.argv.slice(2)) {
  const options = parseReportArgs(argv);
  const pack = buildRedditDmWorkflowHardeningPack(readRevenueLoopReport());
  const written = writeRedditDmWorkflowHardeningPack(pack, options);

  if (written.docsPath) {
    console.log(`Reddit DM pack updated: ${written.docsPath}`);
  }
  if (written.reportDir) {
    console.log(`Reddit DM pack artifacts written to ${written.reportDir}`);
  }
}

if (isCliCall(process.argv, __filename)) {
  main();
}

module.exports = {
  CANONICAL_HEADLINE,
  CANONICAL_SHORT_DESCRIPTION,
  DOCS_PATH,
  buildEvidenceBackstop,
  buildEvidenceSurfaces,
  buildFollowOnOffers,
  buildOperatorQueue,
  buildOutreachDrafts,
  buildRedditDmWorkflowHardeningPack,
  buildTrackedRedditLink,
  collectPainSignals,
  formatPainSignals,
  getWarmRedditTargets,
  main,
  renderDraftsCsv,
  renderOperatorQueueCsv,
  renderRedditDmWorkflowHardeningPackMarkdown,
  writeRedditDmWorkflowHardeningPack,
};
