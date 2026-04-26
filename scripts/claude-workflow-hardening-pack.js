'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { ensureDir } = require('./fs-utils');

function normalizeText(value) {
  return String(value ?? '').trim();
}

function hasEvidenceLabel(target, label) {
  const evidence = Array.isArray(target?.evidence) ? target.evidence : [];
  const needle = normalizeText(label).toLowerCase();
  return evidence.some((entry) => normalizeText(entry).toLowerCase() === needle);
}

function isWarmTarget(target) {
  return normalizeText(target?.temperature).toLowerCase() === 'warm';
}

function isClaudeTarget(target) {
  const haystack = [
    target?.accountName,
    target?.repoName,
    target?.description,
    target?.source,
    target?.channel,
  ].map(normalizeText).join(' ').toLowerCase();
  return /claude/.test(haystack);
}

function hasRepo(target) {
  return Boolean(normalizeText(target?.repoName) && normalizeText(target?.repoUrl));
}

function summarizeExamples(targets = [], limit = 3) {
  return targets.slice(0, limit).map((target) => {
    if (hasRepo(target)) {
      return `${target.username}/${target.repoName}`;
    }
    return `@${target.username}`;
  });
}

function buildSignalSummary(report = {}) {
  const targets = Array.isArray(report.targets) ? report.targets : [];
  const warmClaudeTargets = targets.filter((target) => isWarmTarget(target) && isClaudeTarget(target));
  const productionTargets = targets.filter((target) => hasEvidenceLabel(target, 'production or platform workflow'));
  const businessSystemTargets = targets.filter((target) => hasEvidenceLabel(target, 'business-system integration'));

  return [
    {
      key: 'warm_claude_workflows',
      label: 'Warm Claude workflow pain already exists',
      count: warmClaudeTargets.length,
      summary: `${warmClaudeTargets.length} warm Claude-first signals already named review boundaries, brittle guardrails, or context-risk pain.`,
      examples: summarizeExamples(warmClaudeTargets),
    },
    {
      key: 'production_rollout',
      label: 'Production rollout proof is the strongest cold signal',
      count: productionTargets.length,
      summary: `${productionTargets.length} current targets touch releases, incidents, or other production-sensitive workflows that need approval boundaries and proof.`,
      examples: summarizeExamples(productionTargets),
    },
    {
      key: 'business_system_approvals',
      label: 'Business-system approvals are present but secondary',
      count: businessSystemTargets.length,
      summary: `${businessSystemTargets.length} current targets wire agents into business systems where rollback safety and approvals matter.`,
      examples: summarizeExamples(businessSystemTargets),
    },
  ].filter((entry) => entry.count > 0);
}

function buildLaneEvidenceSentence(count, noun, examples = []) {
  const exampleText = examples.length ? ` Examples: ${examples.join(', ')}.` : '';
  return `${count} ${noun}.${exampleText}`;
}

function buildBuyerLanes(report = {}) {
  const targets = Array.isArray(report.targets) ? report.targets : [];
  const warmClaudeTargets = targets.filter((target) => isWarmTarget(target) && isClaudeTarget(target));
  const productionTargets = targets.filter((target) => hasEvidenceLabel(target, 'production or platform workflow'));
  const businessSystemTargets = targets.filter((target) => hasEvidenceLabel(target, 'business-system integration'));

  const lanes = [];

  if (warmClaudeTargets.length) {
    lanes.push({
      key: 'claude_first_workflow_owner',
      audience: 'Claude-first builders and workflow owners',
      evidence: buildLaneEvidenceSentence(
        warmClaudeTargets.length,
        'warm Claude-first signals already named concrete workflow pain',
        summarizeExamples(warmClaudeTargets)
      ),
      angle: 'Lead with one repeated workflow failure inside an already-serious Claude process. Do not open with proof.',
      firstTouchDraft: 'You are already running a serious Claude workflow. I am looking for one Claude-first workflow to harden end-to-end this week: repeated failure, pre-action gate, and proof run. If one review boundary or brittle-guardrail failure keeps coming back, I can harden that workflow for you.',
      painConfirmedFollowUpDraft: 'If that Claude workflow really has one repeated failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence so the next step stays grounded.',
    });
  }

  if (productionTargets.length) {
    lanes.push({
      key: 'platform_rollout_owner',
      audience: 'Platform teams shipping agents near release, incident, or compliance surfaces',
      evidence: buildLaneEvidenceSentence(
        productionTargets.length,
        'current targets expose production or platform workflows where proof matters before rollout',
        summarizeExamples(productionTargets)
      ),
      angle: 'Lead with approval boundaries, rollback safety, and proof for one production workflow.',
      firstTouchDraft: 'I am looking for one production workflow to harden end-to-end this week: repeated failure, prevention gate, and proof run. If one release, incident, or compliance-adjacent workflow keeps needing manual rescue, I can harden that workflow for you.',
      painConfirmedFollowUpDraft: 'If that production workflow is real, I can send the Workflow Hardening Sprint brief with commercial truth and verification evidence after the buyer confirms the specific blocker.',
    });
  }

  if (businessSystemTargets.length) {
    lanes.push({
      key: 'business_system_operator',
      audience: 'Teams wiring agents into Jira, ServiceNow, Slack, or other business systems',
      evidence: buildLaneEvidenceSentence(
        businessSystemTargets.length,
        'current targets touch business-system workflows where approvals and rollback safety are explicit buying triggers',
        summarizeExamples(businessSystemTargets)
      ),
      angle: 'Lead with one business-system workflow that needs approval boundaries, rollback safety, and proof.',
      firstTouchDraft: 'I am looking for one agent workflow touching Jira, ServiceNow, Slack, or another business system to harden end-to-end this week. If one approval or handoff failure keeps repeating, I can harden that workflow for you.',
      painConfirmedFollowUpDraft: 'Once the buyer confirms the failing business-system workflow, send the Workflow Hardening Sprint brief plus commercial truth and verification evidence. Do not lead with the proof pack.',
    });
  }

  return lanes;
}

function buildPackTargets(report = {}) {
  const targets = Array.isArray(report.targets) ? report.targets : [];
  return targets.slice(0, 6).map((target) => ({
    account: hasRepo(target) ? `${target.username}/${target.repoName}` : `@${target.username}`,
    temperature: normalizeText(target.temperature) || 'cold',
    why: normalizeText(target.motionReason) || normalizeText(target.outreachAngle),
    motion: normalizeText(target.motionLabel),
  }));
}

function buildClaudeWorkflowHardeningPack(report = {}) {
  const signals = buildSignalSummary(report);
  const buyerLanes = buildBuyerLanes(report);

  return {
    generatedAt: normalizeText(report.generatedAt) || new Date().toISOString(),
    objective: 'Turn current Claude-first buyer signals into booked workflow-hardening diagnostics and self-serve follow-up only after pain is confirmed.',
    state: normalizeText(report.directive?.state) || 'cold-start',
    headline: 'Make one Claude-first workflow safe enough to ship team-wide.',
    summary: [
      'ThumbGate should sell Claude workflow hardening as a concrete delivery motion, not generic AI governance.',
      normalizeText(report.directive?.headline),
    ].filter(Boolean).join(' '),
    primaryOffer: {
      label: normalizeText(report.currentTruth?.teamPilotOffer) || 'Workflow Hardening Sprint',
      cta: normalizeText(report.targets?.find((target) => normalizeText(target.motion) === 'sprint')?.cta),
    },
    secondaryOffer: {
      label: normalizeText(report.currentTruth?.publicSelfServeOffer) || 'Pro at $19/mo or $149/yr',
      cta: normalizeText(report.targets?.find((target) => normalizeText(target.motion) === 'pro')?.cta),
    },
    proofPolicy: 'Do not lead with proof links. Use Commercial Truth and Verification Evidence only after the buyer confirms workflow pain.',
    signals,
    buyerLanes,
    sampleTargets: buildPackTargets(report),
    proofLinks: [
      normalizeText(report.currentTruth?.commercialTruthLink),
      normalizeText(report.currentTruth?.verificationEvidenceLink),
    ].filter(Boolean),
  };
}

function renderClaudeWorkflowHardeningPackMarkdown(pack = {}) {
  const signalLines = Array.isArray(pack.signals) && pack.signals.length
    ? pack.signals.flatMap((signal) => ([
      `### ${signal.label}`,
      `- Count: ${signal.count}`,
      `- Summary: ${signal.summary}`,
      `- Examples: ${signal.examples.length ? signal.examples.join(', ') : 'n/a'}`,
      '',
    ]))
    : ['- No evidence-backed Claude signals were available in this run.', ''];
  const laneLines = Array.isArray(pack.buyerLanes) && pack.buyerLanes.length
    ? pack.buyerLanes.flatMap((lane) => ([
      `### ${lane.audience}`,
      `- Evidence: ${lane.evidence}`,
      `- Angle: ${lane.angle}`,
      `- First touch: ${lane.firstTouchDraft}`,
      `- Pain-confirmed follow-up: ${lane.painConfirmedFollowUpDraft}`,
      '',
    ]))
    : ['- No buyer lanes were available in this run.', ''];
  const sampleTargetLines = Array.isArray(pack.sampleTargets) && pack.sampleTargets.length
    ? pack.sampleTargets.map((target) => `- ${target.account} (${target.temperature}): ${target.why}`)
    : ['- No sample targets available in this run.'];
  const proofLines = Array.isArray(pack.proofLinks) && pack.proofLinks.length
    ? pack.proofLinks.map((link) => `- ${link}`)
    : ['- No proof links available in this run.'];

  return [
    '# Claude Workflow Hardening Pack',
    '',
    `Updated: ${pack.generatedAt}`,
    '',
    'This is a sales operator artifact. It is not proof of sent outreach, partner acceptance, booked revenue, or deployment success by itself.',
    '',
    '## Objective',
    pack.objective,
    '',
    '## Positioning',
    `- State: ${pack.state}`,
    `- Headline: ${pack.headline}`,
    `- Summary: ${pack.summary}`,
    '',
    '## Offer Stack',
    `- Primary: ${pack.primaryOffer?.label || 'n/a'}${pack.primaryOffer?.cta ? ` -> ${pack.primaryOffer.cta}` : ''}`,
    `- Secondary: ${pack.secondaryOffer?.label || 'n/a'}${pack.secondaryOffer?.cta ? ` -> ${pack.secondaryOffer.cta}` : ''}`,
    `- Proof policy: ${pack.proofPolicy}`,
    '',
    '## Evidence-Backed Signals',
    ...signalLines,
    '## Buyer Lanes',
    ...laneLines,
    '## Sample Targets Behind This Pack',
    ...sampleTargetLines,
    '',
    '## Proof Links',
    ...proofLines,
    '',
  ].join('\n');
}

function writeClaudeWorkflowHardeningPack(pack, options = {}) {
  const repoRoot = path.resolve(__dirname, '..');
  const markdown = renderClaudeWorkflowHardeningPackMarkdown(pack);
  const reportDir = normalizeText(options.reportDir)
    ? path.resolve(repoRoot, options.reportDir)
    : '';
  const docsPath = path.join(repoRoot, 'docs', 'marketing', 'claude-workflow-hardening-pack.md');

  if (reportDir) {
    ensureDir(reportDir);
    fs.writeFileSync(path.join(reportDir, 'claude-workflow-hardening-pack.md'), markdown, 'utf8');
    fs.writeFileSync(path.join(reportDir, 'claude-workflow-hardening-pack.json'), `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
  }

  if (options.writeDocs) {
    fs.writeFileSync(docsPath, markdown, 'utf8');
  }

  return {
    markdown,
    docsPath: options.writeDocs ? docsPath : null,
    reportDir: reportDir || null,
  };
}

module.exports = {
  buildClaudeWorkflowHardeningPack,
  buildSignalSummary,
  buildBuyerLanes,
  renderClaudeWorkflowHardeningPackMarkdown,
  writeClaudeWorkflowHardeningPack,
};
