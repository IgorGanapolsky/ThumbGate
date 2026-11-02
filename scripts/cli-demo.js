#!/usr/bin/env node
'use strict';

// cli-demo.js — simulated walkthrough of the ThumbGate value prop

const BD = '\x1b[1m';
const RST = '\x1b[0m';
const G = '\x1b[32m';
const R = '\x1b[31m';
const C = '\x1b[36m';
const Y = '\x1b[33m';
const D = '\x1b[90m';

function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin — no async needed for short delays */ }
}

function runDemo(options = {}) {
  const json = options.json || false;

  if (json) {
    const steps = [
      { step: 1, event: 'bad_action', description: 'Agent runs: git push --force origin main', result: 'executed', badge: 'ALLOWED' },
      { step: 2, event: 'thumbs_down', description: 'User gives thumbs-down feedback', signal: 'down', context: 'force-pushed to main, overwrote teammate\'s work' },
      { step: 3, event: 'lesson_created', description: 'ThumbGate creates a lesson from the feedback', lesson: { id: 'demo-lesson-001', signal: 'negative', context: 'force-pushed to main', whatWentWrong: 'Overwrote teammate\'s commits on main branch', whatToChange: 'Never force-push to protected branches' } },
      { step: 4, event: 'gate_promoted', description: 'Pattern detected: 2+ failures on force-push → auto-promoted to blocking gate', gate: { id: 'auto-block-force-push', pattern: 'git push --force.*main', action: 'block', occurrences: 2 } },
      { step: 5, event: 'gate_fires', description: 'Next session: agent tries git push --force origin main', result: 'BLOCKED', reason: 'Auto-promoted gate: force-push to main detected' },
    ];
    return { demo: true, steps };
  }

  const lines = [];
  const w = (s) => lines.push(s);

  w('');
  w(`${BD}${C}thumbgate demo${RST} — see ThumbGate in action (simulated)`);
  w('═'.repeat(60));
  w('');

  // Step 1: Bad action
  w(`${BD}Session 1: Agent runs a risky command${RST}`);
  w(`${D}─────────────────────────────────────${RST}`);
  w(`  ${D}Agent>${RST} ${BD}git push --force origin main${RST}`);
  w(`  ${G}[ALLOWED]${RST} — No gates configured yet, action proceeds.`);
  w(`  ${R}💥 Result: teammate's commits overwritten on main${RST}`);
  w('');

  // Step 2: Thumbs down
  w(`${BD}You give feedback:${RST}`);
  w(`  ${R}👎 thumbs-down${RST} — "force-pushed to main, overwrote teammate's work"`);
  w('');

  // Step 3: Lesson
  w(`${BD}ThumbGate captures a lesson:${RST}`);
  w(`${D}─────────────────────────────────────${RST}`);
  w(`  ${Y}[LEARNING]${RST} Lesson created`);
  w(`  Signal      : ${R}negative${RST}`);
  w(`  Context     : force-pushed to main`);
  w(`  Root cause  : Overwrote teammate's commits on main branch`);
  w(`  Corrective  : Never force-push to protected branches`);
  w(`  Tags        : git, deployment, data-loss`);
  w('');

  // Step 4: Gate promotion
  w(`${BD}Pattern detected (2+ similar failures):${RST}`);
  w(`  ${Y}→${RST} Auto-promoted to ${R}blocking gate${RST}`);
  w(`  Gate ID     : auto-block-force-push`);
  w(`  Pattern     : git push --force.*main`);
  w(`  Action      : ${R}block${RST}`);
  w('');

  // Step 5: Next session — blocked
  w(`${BD}Session 2: Agent tries the same command${RST}`);
  w(`${D}─────────────────────────────────────${RST}`);
  w(`  ${D}Agent>${RST} ${BD}git push --force origin main${RST}`);
  w(`  ${R}[BLOCKED]${RST} Gate fired: force-push to main detected`);
  w(`  ${G}✅ Mistake prevented. Teammate's work is safe.${RST}`);
  w('');

  w('═'.repeat(60));
  w(`${BD}That's ThumbGate:${RST} one thumbs-down → permanent protection.`);
  w('');
  w(`  Get started: ${C}npx thumbgate init${RST}`);
  w(`  Capture:     ${C}npx thumbgate capture --feedback=down --context="what failed"${RST}`);
  w(`  Check gates: ${C}npx thumbgate gate-stats --json${RST}`);
  w('');

  return lines.join('\n');
}
const SOURCE_URL = 'https://launchvideo.io/';
const REPO_URL = 'https://github.com/diggerhq/shipvideo';
const GATE_ID = 'launchvideo-deterministic-film-diode';

const RAIL_MAP = Object.freeze([
  { launchVideoConcept: '1. Virtual clock replaces rAF/timers/Date/CSS Animations', thumbgateRail: 'buildVirtualClockTimeline + seekVirtualClockFrame' },
  { launchVideoConcept: '2. 3-tool director surface (web_fetch, check_scene, render_video)', thumbgateRail: 'extractBrandTokensFromHtml + checkSceneGate' },
  { launchVideoConcept: '3. Zero-secret per-job 3h scoped Blob upload manifest', thumbgateRail: 'mintScopedBlobUploadManifest' },
  { launchVideoConcept: '4. MP4 artifact in Blob is completion gate', thumbgateRail: 'verifyMp4ArtifactCompletion' },
]);

/**
 * Tool 1 (`web_fetch` format): Extract brand identity tokens (title, headings,
 * top hex colors sorted by frequency, and Google Fonts) from a product HTML page.
 */
function stripMarkupToPlainText(fragment = '') {
  return String(fragment || '')
    .split('<')
    .map((chunk, idx) => {
      if (idx === 0) return chunk;
      const closeIdx = chunk.indexOf('>');
      return closeIdx === -1 ? '' : chunk.slice(closeIdx + 1);
    })
    .join(' ')
    .replace(/[<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractBrandTokensFromHtml(html = '') {
  const src = String(html || '');
  const titleMatch = src.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripMarkupToPlainText(titleMatch[1]) : '';

  const headings = [];
  const headingRe = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let hm;
  while ((hm = headingRe.exec(src)) !== null) {
    const clean = stripMarkupToPlainText(hm[1]);
    if (clean) headings.push(clean);
  }

  const colorCounts = new Map();
  const hexRe = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
  let cm;
  while ((cm = hexRe.exec(src)) !== null) {
    const raw = cm[1].toLowerCase();
    const norm = raw.length === 3
      ? `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`
      : `#${raw}`;
    colorCounts.set(norm, (colorCounts.get(norm) || 0) + 1);
  }
  const topHexColors = [...colorCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([hex]) => hex);

  const googleFonts = new Set();
  const fontUrlRe = /fonts\.googleapis\.com\/css2?\?([^"'\s>]+)/gi;
  let urlMatch;
  while ((urlMatch = fontUrlRe.exec(src)) !== null) {
    const query = urlMatch[1];
    const famRe = /(?:^|&)family=([^&]+)/gi;
    let fm;
    while ((fm = famRe.exec(query)) !== null) {
      const family = decodeURIComponent(fm[1]).replace(/\+/g, ' ').split(':')[0].trim();
      if (family) googleFonts.add(family);
    }
  }
  return {
    title,
    headings,
    topHexColors,
    googleFonts: [...googleFonts],
  };
}

// Deterministic virtual clock timeline & frame seeker
function buildVirtualClockTimeline({
  durationSeconds = 32,
  fps = 30,
  width = 1920,
  height = 1080,
  crf = 18,
} = {}) {
  const dur = Math.max(1, Number(durationSeconds) || 32);
  const frameRate = Math.max(1, Number(fps) || 30);
  const totalFrames = Math.round(dur * frameRate);
  return {
    usesVideoDiffusionModel: false,
    patchedApis: ['requestAnimationFrame', 'setTimeout', 'setInterval', 'Date.now', 'performance.now', 'CSSAnimations', 'WebAnimations'],
    width,
    height,
    fps: frameRate,
    durationSeconds: dur,
    totalFrames,
    codec: 'libx264',
    crf,
    pixelFormat: 'yuv420p',
  };
}

function seekVirtualClockFrame(frameIndex, fps = 30) {
  const idx = Math.max(0, Math.floor(Number(frameIndex) || 0));
  const rate = Math.max(1, Number(fps) || 30);
  return {
    frameIndex: idx,
    fps: rate,
    virtualTimeMs: Number(((idx / rate) * 1000).toFixed(3)),
    deterministic: true,
  };
}

// Scene gate before render_video
function checkSceneGate({ jsErrors = [], sampleFrames = [] } = {}) {
  const errors = Array.isArray(jsErrors) ? jsErrors.filter(Boolean) : [];
  const samples = Array.isArray(sampleFrames) ? sampleFrames : [];
  const blankTimestamps = samples
    .filter((s) => !String(s.visibleText || '').trim())
    .map((s) => s.timestampSeconds ?? s.t ?? 0);

  const readyToRender = errors.length === 0 && samples.length > 0 && blankTimestamps.length === 0;
  return {
    readyToRender,
    jsErrorCount: errors.length,
    jsErrors: errors,
    sampleCount: samples.length,
    blankTimestamps,
    reason: readyToRender
      ? 'scene_verified_for_ffmpeg_render'
      : (errors.length > 0
        ? 'js_runtime_errors_detected'
        : (samples.length === 0 ? 'no_sample_timestamps_checked' : 'blank_visible_text_at_sample_timestamp')),
  };
}

// Zero-secret per-job upload manifest
function mintScopedBlobUploadManifest({
  jobId = '',
  ttlSeconds = 10800,
  agentEnv = {},
} = {}) {
  const cleanJobId = String(jobId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
  if (!cleanJobId) {
    return { ok: false, reason: 'missing_job_id' };
  }

  const leakedSecrets = Object.keys(agentEnv || {}).filter((k) =>
    /^(?:BLOB_READ_WRITE_TOKEN|AWS_SECRET_ACCESS_KEY|SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY)$/i.test(k)
    && Boolean(agentEnv[k])
  );
  if (leakedSecrets.length > 0) {
    return {
      ok: false,
      agentHoldsMasterSecret: true,
      leakedSecrets,
      reason: 'agent_must_not_hold_master_storage_secrets',
    };
  }

  const boundedTtl = Math.min(10800, Math.max(60, Number(ttlSeconds) || 10800));
  return {
    ok: true,
    jobId: cleanJobId,
    agentHoldsMasterSecret: false,
    scopedPath: `jobs/${cleanJobId}/launch.mp4`,
    ttlSeconds: boundedTtl,
    maxAllowedTtlSeconds: 10800,
  };
}

// MP4 artifact completion verifier
function verifyMp4ArtifactCompletion({
  events = [],
  blobArtifact = null,
} = {}) {
  const eventTypes = (Array.isArray(events) ? events : []).map((e) => (typeof e === 'string' ? e : e.type));
  const turnCompleted = eventTypes.includes('turn.completed');
  const hasValidMp4 = Boolean(
    blobArtifact
    && typeof blobArtifact.url === 'string'
    && blobArtifact.url.endsWith('.mp4')
    && Number(blobArtifact.sizeBytes) > 0
  );

  return {
    done: hasValidMp4,
    turnCompleted,
    hasValidMp4,
    status: hasValidMp4
      ? 'mp4_verified_in_blob'
      : (turnCompleted ? 'turn_completed_without_mp4_artifact' : 'in_progress'),
  };
}

function buildLaunchVideoHonestyReport(options = {}) {
  const findings = [];
  const claim = String(options.claim || '').trim();
  if (/\bvideo\s+diffusion\s+model\b|\bsora\b|\brunway\s+gen\b/i.test(claim)) {
    findings.push({
      id: 'no-video-diffusion-model',
      severity: 'fail',
      gateId: GATE_ID,
      message: 'LaunchVideo format writes the film as code and seeks a deterministic virtual clock into libx264; do not invoke a video diffusion model.',
    });
  }
  if (/\bturn\.completed\s+means\s+video\s+is\s+done\b/i.test(claim)) {
    findings.push({
      id: 'mp4-in-blob-is-the-completion-gate',
      severity: 'fail',
      gateId: GATE_ID,
      message: 'Treat the verified MP4 appearing in Blob storage as done, never turn.completed alone.',
    });
  }

  return {
    ok: findings.length === 0,
    status: findings.length === 0 ? 'ready' : 'fail',
    sourceUrl: SOURCE_URL,
    repoUrl: REPO_URL,
    gateId: GATE_ID,
    railMap: RAIL_MAP,
    findings,
  };
}

const CELLO_REPO_URL = 'https://github.com/Devil-Hawk/cello';
const CELLO_GATE_ID = 'cello-thumbgate-career-agent-diode';
const PAYOUT_ELIGIBLE_WORK_AUTH = new Set(['CPT', 'OPT', 'STEM_OPT', 'O1A']);
const CELLO_RAIL_MAP = Object.freeze([
  { celloMechanism: '1. Atomic Approve-and-Send Outreach Diode', thumbgateRail: 'evaluateCelloOutreachGate' },
  { celloMechanism: '2. Stateless MCP Refusal on Send/Submit Tools', thumbgateRail: 'evaluateCelloMcpAndChokepointGate' },
  { celloMechanism: '3. Judge Verdicts -> DPO Pairs & Prevention Rules', thumbgateRail: 'compileCelloJudgeToDpoPair' },
  { celloMechanism: '4. F-1 Visa-Safe MoR Partner Escrow Ledger', thumbgateRail: 'buildCelloMoRPartnerLedgerEntry' },
]);

function evaluateCelloOutreachGate({
  status = 'pending_review',
  humanApproved = false,
  autoSend = false,
  sentToday = 0,
  dailyCap = 10,
  kind = 'initial',
  parentSentAt = null,
  followUpDays = 5,
  nowMs = Date.now(),
} = {}) {
  if (status === 'sent') return { allowed: false, nextStatusOnFailure: 'sent', reason: 'already_sent' };
  if (status === 'skipped' || status === 'failed') return { allowed: false, nextStatusOnFailure: status, reason: `message_is_${status}` };
  const parsedCap = Number(dailyCap);
  const cap = Number.isFinite(parsedCap) ? Math.max(1, parsedCap) : 10;
  const sent = Number(sentToday);
  if (!Number.isFinite(sent) || sent >= cap) {
    return { allowed: false, nextStatusOnFailure: status === 'pending_review' ? 'pending_review' : status, reason: `daily_cap_reached (${sentToday}/${cap})` };
  }
  if (kind === 'follow_up') {
    if (!parentSentAt) return { allowed: false, nextStatusOnFailure: 'pending_review', reason: 'parent_was_never_sent' };
    const sentMs = new Date(parentSentAt).getTime();
    if (!Number.isFinite(sentMs)) return { allowed: false, nextStatusOnFailure: 'pending_review', reason: 'parent_send_time_unreadable_nan_guard' };
    const parsedDays = Number(followUpDays);
    const needMs = (Number.isFinite(parsedDays) ? Math.max(1, parsedDays) : 5) * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(nowMs) || nowMs - sentMs < needMs) return { allowed: false, nextStatusOnFailure: 'pending_review', reason: 'follow_up_window_not_elapsed' };
  }
  if (status === 'pending_review' && humanApproved === true) {
    return {
      allowed: true,
      atomicApproveAndSend: true,
      nextStatusOnFailure: 'pending_review',
      reason: 'approved_for_delivery',
    };
  }
  return { allowed: false, nextStatusOnFailure: 'pending_review', reason: 'awaiting_human_approval' };
}

function evaluateCelloMcpAndChokepointGate({
  toolName = '',
  isDemoProfile = false,
  hasMcpScope = true,
  hasHumanConfirmChannel = false,
  employerTextFramed = true,
  withinMonthlyBudgetCap = true,
  resumeFabricationCount = 0,
} = {}) {
  const blockers = [];
  if (isDemoProfile) blockers.push('demo_workspace_cannot_use_mcp');
  if (!hasMcpScope) blockers.push('missing_mcp_token_scope');
  if (!withinMonthlyBudgetCap) blockers.push('monthly_spend_cap_exceeded');
  if (!employerTextFramed) blockers.push('unframed_employer_text_prompt_injection_risk');
  if (Number(resumeFabricationCount) > 0) blockers.push('resume_fabrication_detected_against_ground_truth');
  if (/(?:^|[_.:-])(?:send|submit)(?:[_.:-]|$)/i.test(String(toolName || '').trim()) && !hasHumanConfirmChannel) {
    blockers.push('mcp_headless_send_or_submit_refused_without_human_click');
  }
  return { allowed: blockers.length === 0, decision: blockers.length === 0 ? 'ALLOW' : 'DENY', toolName, blockers };
}

function compileCelloJudgeToDpoPair({
  jobTitle = 'Senior AI Engineer',
  companyName = 'Acme AI',
  rejectedDraft = '',
  chosenDraft = '',
  judgeVerdictReason = 'Fabricated skill not present in ground-truth resume',
} = {}) {
  return {
    prompt: `Tailor resume/outreach for ${jobTitle} at ${companyName} strictly using verified candidate facts.`,
    chosen: String(chosenDraft || '').trim(),
    rejected: String(rejectedDraft || '').trim(),
    metadata: { source: 'cello-judge-bridge', companyName, jobTitle, judgeVerdictReason },
    preventionRule: `NEVER claim unverified candidate skills or auto-send outreach for ${companyName} (${judgeVerdictReason}).`,
  };
}

function buildCelloMoRPartnerLedgerEntry({
  orderId = 'ord_cello_001',
  planId = 'pro_cello_bundle',
  grossAmountCents = 1900,
  partnerShareBps = 5000,
  workAuthVerified = false,
  workAuthType = null,
} = {}) {
  const gross = Math.max(0, Math.floor(Number(grossAmountCents) || 0));
  const rawBps = Number(partnerShareBps);
  const bps = Number.isFinite(rawBps) ? Math.min(10000, Math.max(0, Math.floor(rawBps))) : 5000;
  const partnerAccruedCents = Math.floor((gross * bps) / 10000);
  const normalizedAuthType = String(workAuthType || '').toUpperCase().replace(/[\s-]/g, '');
  const canDisburseNow = Boolean(workAuthVerified && PAYOUT_ELIGIBLE_WORK_AUTH.has(normalizedAuthType));
  return {
    orderId,
    partnerRepo: CELLO_REPO_URL,
    merchantOfRecord: 'ThumbGate (Igor Ganapolsky)',
    planId,
    grossAmountCents: gross,
    partnerShareBps: bps,
    partnerAccruedCents,
    workAuthVerified: Boolean(workAuthVerified),
    workAuthType: workAuthType || 'F1_NO_ACTIVE_PAYOUT',
    payoutStatus: canDisburseNow ? 'READY_FOR_AUTHORIZED_DISBURSEMENT' : 'DEFERRED_ESCROW_UNTIL_WORK_AUTH',
  };
}

function buildCelloIntegrationReport(options = {}) {
  const findings = [];
  const claim = String(options.claim || '').trim();
  if (/\bdirect\s+stripe\s+payout\s+on\s+unauthorized\s+f1\b/i.test(claim)) {
    findings.push({
      id: 'f1-visa-unauthorized-payout-blocked',
      severity: 'fail',
      gateId: CELLO_GATE_ID,
      message: 'Keep ThumbGate as 100% Merchant of Record and hold partner revenue in deferred escrow until CPT/OPT/O-1A work authorization is verified.',
    });
  }
  return {
    ok: findings.length === 0,
    status: findings.length === 0 ? 'ready' : 'fail',
    sourceUrl: CELLO_REPO_URL,
    gateId: CELLO_GATE_ID,
    railMap: CELLO_RAIL_MAP,
    findings,
  };
}
const TRUST_SCORE_SOURCE_URL = 'https://thenewstack.io/ai-agent-trust-score/';
const TRUST_SCORE_GATE_ID = 'vijil-feral-to-fiduciary-trust-credit-line';

const TRUST_SCORE_RAIL_MAP = Object.freeze([
  { vijilConcept: '1. Trust as a Line of Credit (300-850 score)', thumbgateRail: 'evaluateAgentTrustCreditLine' },
  { vijilConcept: '2. Four Post-Launch Feral Agent Failure Modes', thumbgateRail: 'detectFeralAgentDrift' },
  { vijilConcept: '3. Policy Tracks vs Wall-Bounce Loops', thumbgateRail: 'evaluateAgentTrustCreditLine' },
]);

function evaluateAgentTrustCreditLine({
  passedEvals = 0,
  totalEvals = 0,
  verifiedOutcomes = 0,
  policyViolations = 0,
  wallBounceRetries = 0,
  approvedCreditLimitUsd = 10,
  requestedActionCostUsd = 2,
  requestedScopeEscalation = false,
  principalApprovedEscalation = false,
} = {}) {
  const evalRatio = Math.min(1, Math.max(0, Number(passedEvals) / Math.max(1, Number(totalEvals) || 1)));
  const baseScore = 300 + Math.round(evalRatio * 450) + Math.min(100, Math.max(0, Number(verifiedOutcomes) * 5));
  const penalty = (Number(policyViolations) || 0) * 120 + (Number(wallBounceRetries) || 0) * 35;
  const trustScore = Math.max(300, Math.min(850, baseScore - penalty));

  const behavioralState = trustScore >= 740 && penalty === 0
    ? 'FIDUCIARY'
    : (trustScore >= 580 ? 'DOMESTICATED' : 'FERAL');

  const blockers = [];
  if (behavioralState === 'FERAL') blockers.push('agent_trust_score_feral_below_580');
  if (Number(wallBounceRetries) >= 3) blockers.push('mario_kart_wall_bounce_loop_detected');
  const costUsd = Number(requestedActionCostUsd);
  const limitUsd = Number(approvedCreditLimitUsd);
  if (!Number.isFinite(costUsd) || costUsd < 0 || !Number.isFinite(limitUsd) || limitUsd < 0 || costUsd > limitUsd) {
    blockers.push('exceeds_approved_autonomy_credit_limit');
  }
  if (requestedScopeEscalation && !principalApprovedEscalation) {
    blockers.push('higher_trust_score_does_not_auto_increase_credit_limit_without_principal');
  }

  return {
    allowed: blockers.length === 0,
    trustScore,
    behavioralState,
    approvedCreditLimitUsd: Number(approvedCreditLimitUsd),
    requestedActionCostUsd: Number(requestedActionCostUsd),
    localEvaluationOnly: true,
    blockers,
  };
}

function detectFeralAgentDrift({
  environmentChangedSinceBaseline = false,
  retestedAfterEnvironmentChange = true,
  untrustedInputReachedTool = false,
  hasAgentIdentityAndTrace = true,
  multiAgentCombinedPolicyBreach = false,
} = {}) {
  const feralModes = [];
  if (environmentChangedSinceBaseline && !retestedAfterEnvironmentChange) feralModes.push('environment_drift');
  if (untrustedInputReachedTool) feralModes.push('adversarial_hijack');
  if (!hasAgentIdentityAndTrace) feralModes.push('ungoverned_agent');
  if (multiAgentCombinedPolicyBreach) feralModes.push('multi_agent_composition_breach');
  return {
    isFeral: feralModes.length > 0,
    feralModes,
    action: feralModes.length > 0 ? 'REVOKE_AUTONOMY_AND_RETEST' : 'KEEP_ON_POLICY_TRACKS',
  };
}

function buildAgentTrustScoreHonestyReport(options = {}) {
  const findings = [];
  const claim = String(options.claim || '').trim();
  if (/\bauto[\s-]*increase\s+credit\s+limit\s+from\s+trust\s+score\b/i.test(claim)) {
    findings.push({
      id: 'no-auto-credit-limit-escalation',
      severity: 'fail',
      gateId: TRUST_SCORE_GATE_ID,
      message: 'Improved agent trust score is a reason to keep the agent operating, never to auto-escalate its credit limit or tool scope without principal approval.',
    });
  }
  return {
    ok: findings.length === 0,
    status: findings.length === 0 ? 'ready' : 'fail',
    sourceUrl: TRUST_SCORE_SOURCE_URL,
    gateId: TRUST_SCORE_GATE_ID,
    railMap: TRUST_SCORE_RAIL_MAP,
    findings,
  };
}

function runCli(argv = process.argv.slice(2)) {
  const args = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [k, ...rest] = arg.slice(2).split('=');
    args[k] = rest.length ? rest.join('=') : true;
  }
  const report = args['trust-score']
    ? buildAgentTrustScoreHonestyReport(args)
    : (args.cello ? buildCelloIntegrationReport(args) : buildLaunchVideoHonestyReport(args));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.ok ? 0 : 1;
}

module.exports = {
  runDemo,
  SOURCE_URL,
  REPO_URL,
  GATE_ID,
  RAIL_MAP,
  extractBrandTokensFromHtml,
  buildVirtualClockTimeline,
  seekVirtualClockFrame,
  checkSceneGate,
  mintScopedBlobUploadManifest,
  verifyMp4ArtifactCompletion,
  buildLaunchVideoHonestyReport,
  CELLO_REPO_URL,
  CELLO_GATE_ID,
  CELLO_RAIL_MAP,
  evaluateCelloOutreachGate,
  evaluateCelloMcpAndChokepointGate,
  compileCelloJudgeToDpoPair,
  buildCelloMoRPartnerLedgerEntry,
  buildCelloIntegrationReport,
  TRUST_SCORE_SOURCE_URL,
  TRUST_SCORE_GATE_ID,
  TRUST_SCORE_RAIL_MAP,
  evaluateAgentTrustCreditLine,
  detectFeralAgentDrift,
  buildAgentTrustScoreHonestyReport,
  runCli,
};
