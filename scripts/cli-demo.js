#!/usr/bin/env node
'use strict';

/**
 * cli-demo.js — simulated walkthrough of the ThumbGate value prop.
 *
 * Shows in ~10 seconds:
 *   1. A mock bad action (force-push)
 *   2. Giving it a thumbs-down
 *   3. Lesson created
 *   4. Next session: gate fires, action blocked
 *
 * No actual data is written — this is a pure simulation for onboarding.
 */

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
  {
    launchVideoConcept: 'No video diffusion model: LLM writes film as HTML/CSS/JS; virtual clock replaces rAF/timers/Date/Web Animations (1920x1080 @ 30fps, libx264 crf 18)',
    thumbgateRail: 'buildVirtualClockTimeline + seekVirtualClockFrame (usesVideoDiffusionModel=false; deterministic frame seek)',
  },
  {
    launchVideoConcept: '3-tool director surface: web_fetch (text, headings, top hex colors, Google Fonts), check_scene (JS errors + visible text at sample timestamps), render_video',
    thumbgateRail: 'extractBrandTokensFromHtml + checkSceneGate (blocks render_video on JS errors or blank sample frames)',
  },
  {
    launchVideoConcept: 'Agent holds no secrets: per-job manifest mints 3-hour single-path Blob upload token',
    thumbgateRail: 'mintScopedBlobUploadManifest (agentHoldsMasterSecret=false; blocks raw BLOB_READ_WRITE_TOKEN / AWS secrets; TTL <= 10800s)',
  },
  {
    launchVideoConcept: 'Control plane polls tool.started/tool.completed/turn.completed and treats MP4 appearing in Blob as done',
    thumbgateRail: 'verifyMp4ArtifactCompletion (turn.completed alone is not done; requires verified MP4 artifact with sizeBytes > 0)',
  },
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

/**
 * Deterministic virtual clock timeline & frame seeker (no video diffusion model).
 */
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

/**
 * Tool 2 (`check_scene` gate before `render_video`):
 * Verifies zero JS runtime errors and non-empty visible text across sampled timestamps.
 */
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

/**
 * Zero-secret per-job upload manifest (3-hour max TTL, single path scope).
 */
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

/**
 * Control-plane completion verifier: `turn.completed` alone is NOT done;
 * the MP4 artifact must exist in Blob storage with non-zero bytes.
 */
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

function runCli(argv = process.argv.slice(2)) {
  const args = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [k, ...rest] = arg.slice(2).split('=');
    args[k] = rest.length ? rest.join('=') : true;
  }
  const report = buildLaunchVideoHonestyReport(args);
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
  runCli,
};
