#!/usr/bin/env node
'use strict';

/**
 * prove-herdr-adapter.js — Prove Herdr terminal multiplexer governance plugin manifest.
 */

const fs = require('node:fs');
const path = require('node:path');

const MANIFEST_PATH = path.join(__dirname, '..', 'adapters', 'herdr', 'herdr-plugin.toml');

function verifyHerdrPlugin() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return { ok: false, error: `manifest missing at ${MANIFEST_PATH}` };
  }
  const content = fs.readFileSync(MANIFEST_PATH, 'utf8');

  const idMatch = content.match(/^id\s*=\s*"(.*?)"/m);
  const nameMatch = content.match(/^name\s*=\s*"(.*?)"/m);
  const versionMatch = content.match(/^version\s*=\s*"(.*?)"/m);
  const minHerdrMatch = content.match(/^minHerdrVersion\s*=\s*"(.*?)"/m);
  const categoryMatch = content.match(/^category\s*=\s*"(.*?)"/m);
  const commandMatch = content.match(/^command\s*=\s*"(.*?)"/m);

  if (!idMatch || !nameMatch || !versionMatch || !minHerdrMatch || !categoryMatch || !commandMatch) {
    return { ok: false, error: 'missing required fields in herdr-plugin.toml' };
  }

  const pluginId = idMatch[1];
  if (pluginId !== 'thumbgate-approvals') {
    return { ok: false, error: `expected plugin id thumbgate-approvals, got ${pluginId}` };
  }

  return {
    ok: true,
    pluginId,
    pluginName: nameMatch[1],
    version: versionMatch[1],
    category: categoryMatch[1],
    mcpCommand: commandMatch[1],
    mcpArgs: ['--yes', '--package', `thumbgate@${versionMatch[1]}`, 'thumbgate', 'serve'],
  };
}
const SOURCE_URL = 'https://www.youtube.com/watch?v=AL-PQuB2wy0';
const GATE_ID = 'herdr-civilization-governance';

const RAIL_MAP = Object.freeze([
  {
    herdrPillar: '1. Decouple Agent Identity from Ephemeral Sessions (Seats, Pods, Rigs, culture.md, P2P tmux)',
    thumbgateRail: 'buildAgentSeat + occupySeatSession + buildRigPod (static address builder@workshop, tribal wisdom inheritance, mesh_send_peer)',
  },
  {
    herdrPillar: '2. Traversable 3-Altitude Work Graph (Project -> Mission -> Slice with spec->build->test + proof)',
    thumbgateRail: 'buildThreeAltitudeGraph + advanceWorkflowHarness (feeds next slice step; blocks Mission merge without Slice proof)',
  },
  {
    herdrPillar: '3. Upward-Graph Refocus Injections & Altitude-Bridged Approvals',
    thumbgateRail: 'buildRefocusInjection + evaluateAltitudeBridgedApproval (pairs Slice with Project intent; blocks approvals missing Slice or Project context)',
  },
  {
    herdrPillar: '4. Epidemiological Mind-Virus Contact Tracing & Purge',
    thumbgateRail: 'traceAndPurgeMindVirus (contact-traces toxic instructions across seats/docs, purges them, and emits PreToolUse inoculation rule)',
  },
  {
    herdrPillar: '5. Agent Productivity Monitoring (APM) Ceremony-to-Progress Ratio',
    thumbgateRail: 'evaluateCeremonyToProgress (alerts when handoff/check ceremony spikes while completed slices stall; dispatches rig triage agent)',
  },
]);

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

/**
 * Pillar 1: Persistent Seat & Pod abstraction.
 * Ephemeral sessions step into a permanent seat (`role@pod`) and inherit
 * its accumulated tribal wisdom (`lessons`, `notes`, `cultureRef`).
 */
function buildAgentSeat(input = {}) {
  const role = normalizeText(input.role) || 'builder';
  const pod = normalizeText(input.pod) || 'workshop';
  const address = normalizeText(input.address) || `${role}@${pod}`;
  const model = normalizeText(input.model) || 'named-model-required';
  const skills = Array.isArray(input.skills) ? input.skills.map(normalizeText).filter(Boolean) : [];
  const tribalWisdom = Array.isArray(input.tribalWisdom) ? [...input.tribalWisdom] : [];
  const cultureRef = normalizeText(input.cultureRef) || 'culture.md';

  return {
    address,
    role,
    pod,
    model,
    skills,
    cultureRef,
    p2pTransport: normalizeText(input.p2pTransport) || 'local-ipc-or-tailscale-tmux',
    tribalWisdom,
    activeSessionId: null,
  };
}

function occupySeatSession(seat, session = {}) {
  const sessionId = normalizeText(session.sessionId) || `sess_${Date.now()}`;
  const newLessons = Array.isArray(session.newLessons) ? session.newLessons.map(normalizeText).filter(Boolean) : [];
  const mergedWisdom = Array.from(new Set([...(seat.tribalWisdom || []), ...newLessons]));

  return {
    ...seat,
    activeSessionId: sessionId,
    inheritedWisdomCount: (seat.tribalWisdom || []).length,
    tribalWisdom: mergedWisdom,
    p2pRoute: `${seat.address}#${sessionId}`,
  };
}

function buildRigPod({ rigName = 'core-rig', culturePath = 'culture.md', seats = [] } = {}) {
  const normalizedSeats = seats.map((s) => (s.address ? s : buildAgentSeat(s)));
  return {
    rigName: normalizeText(rigName),
    culturePath: normalizeText(culturePath),
    seatAddresses: normalizedSeats.map((s) => s.address),
    seats: normalizedSeats,
  };
}

/**
 * Pillar 2: 3-Altitude Traversable Work Graph (`Project -> Mission -> Slice`)
 * and background workflow harness step feeder.
 */
function buildThreeAltitudeGraph(input = {}) {
  const project = {
    id: normalizeText(input.project?.id) || 'proj_thumbgate',
    title: normalizeText(input.project?.title) || 'ThumbGate Reliability Gateway',
    intent: normalizeText(input.project?.intent) || 'Earn $100/day after-tax profit via sub-5ms PreToolUse governance',
  };

  const missions = (Array.isArray(input.missions) ? input.missions : []).map((m, idx) => {
    const missionId = normalizeText(m.id) || `mission_${idx + 1}`;
    const slices = (Array.isArray(m.slices) ? m.slices : []).map((s, sIdx) => {
      const sequence = Array.isArray(s.sequence) && s.sequence.length > 0
        ? s.sequence
        : ['spec', 'build', 'test'];
      const completedSteps = Array.isArray(s.completedSteps) ? s.completedSteps : [];
      const proofFile = normalizeText(s.proofFile) || null;
      const allStepsDone = sequence.every((step) => completedSteps.includes(step));
      return {
        id: normalizeText(s.id) || `${missionId}_slice_${sIdx + 1}`,
        missionId,
        projectId: project.id,
        title: normalizeText(s.title) || 'Atomic slice',
        specFile: normalizeText(s.specFile) || 'spec.md',
        sequence,
        completedSteps,
        proofFile,
        status: allStepsDone && proofFile ? 'completed' : 'in_progress',
      };
    });

    const readyToMerge = slices.length > 0 && slices.every((s) => s.status === 'completed');
    return {
      id: missionId,
      projectId: project.id,
      title: normalizeText(m.title) || `Mission ${idx + 1}`,
      mergeBoundary: normalizeText(m.mergeBoundary) || 'pr_merge_required',
      readyToMerge,
      slices,
    };
  });

  return { project, missions };
}

function advanceWorkflowHarness(graph) {
  for (const mission of graph.missions || []) {
    for (const slice of mission.slices || []) {
      const nextStep = slice.sequence.find((step) => !slice.completedSteps.includes(step));
      if (nextStep) {
        return {
          done: false,
          projectId: graph.project.id,
          missionId: mission.id,
          sliceId: slice.id,
          nextStep,
          specFile: slice.specFile,
          requiresProof: false,
        };
      }
      if (!slice.proofFile) {
        return {
          done: false,
          projectId: graph.project.id,
          missionId: mission.id,
          sliceId: slice.id,
          nextStep: 'record_proof',
          specFile: slice.specFile,
          requiresProof: true,
        };
      }
    }
  }
  return {
    done: true,
    projectId: graph.project?.id || null,
    missionId: null,
    sliceId: null,
    nextStep: null,
  };
}

/**
 * Pillar 3: Upward-Graph "Refocus" Injection & Altitude-Bridged Approvals.
 */
function buildRefocusInjection(graph, sliceId, currentActivity = '') {
  let foundMission = null;
  let foundSlice = null;
  for (const m of graph.missions || []) {
    const s = (m.slices || []).find((item) => item.id === sliceId);
    if (s) {
      foundMission = m;
      foundSlice = s;
      break;
    }
  }
  if (!foundSlice || !foundMission) {
    return { ok: false, reason: 'slice_not_found_in_graph' };
  }

  const activity = normalizeText(currentActivity);
  const bureaucracyDrift = /\b(?:meta-framework|recursive\s+check|moon\s+base|unrequested\s+abstraction|check\s+the\s+checker)\b/i.test(activity);

  const prompt = [
    `[REFOCUS INJECTION — Altitude Trace: ${foundSlice.id} -> ${foundMission.id} -> ${graph.project.id}]`,
    `Street-Level Slice (${foundSlice.id}): ${foundSlice.title} (spec: ${foundSlice.specFile})`,
    `Mission Milestone (${foundMission.id}): ${foundMission.title}`,
    `Top-Level Project Intent (${graph.project.id}): ${graph.project.intent}`,
    'Alignment Question: Is what you are doing right now directly advancing the Slice spec and Project intent, or has it drifted into scope creep or recursive verification bureaucracy?',
  ].join('\n');

  return {
    ok: true,
    chainOfIntent: [foundSlice.id, foundMission.id, graph.project.id],
    bureaucracyDriftDetected: bureaucracyDrift,
    action: bureaucracyDrift ? 'halt_and_prune_scope_to_slice_spec' : 'continue_slice_execution',
    refocusPrompt: prompt,
  };
}

function evaluateAltitudeBridgedApproval(request = {}) {
  const slice = request.slice || {};
  const mission = request.mission || {};
  const project = request.project || {};
  const missingAltitudes = [];

  if (!normalizeText(slice.id) || !normalizeText(slice.specFile) || !normalizeText(slice.diffSummary)) {
    missingAltitudes.push('slice_street_level_context');
  }
  if (!normalizeText(mission.id)) {
    missingAltitudes.push('mission_milestone_context');
  }
  if (!normalizeText(project.id) || !normalizeText(project.intent)) {
    missingAltitudes.push('project_high_level_intent');
  }

  return {
    allowed: missingAltitudes.length === 0,
    missingAltitudes,
    reason: missingAltitudes.length === 0 ? 'altitude_bridge_complete' : 'missing_altitude_bridge',
  };
}

/**
 * Pillar 4: Epidemiological "Mind Virus" Contact Tracing & Purge.
 */
function traceAndPurgeMindVirus({
  virusId = 'hallucinated-rule',
  virusPattern,
  seats = [],
  documents = [],
} = {}) {
  const re = virusPattern instanceof RegExp
    ? virusPattern
    : new RegExp(normalizeText(virusPattern || 'NEVER_MATCH_EMPTY'), 'i');

  const infectedSeats = [];
  const cleanedSeats = seats.map((seat) => {
    const wisdom = Array.isArray(seat.tribalWisdom) ? seat.tribalWisdom : [];
    const cleanWisdom = wisdom.filter((entry) => !re.test(String(entry)));
    if (cleanWisdom.length !== wisdom.length) {
      infectedSeats.push(seat.address || seat.role || 'unknown_seat');
    }
    return { ...seat, tribalWisdom: cleanWisdom };
  });

  const infectedDocs = [];
  const cleanedDocuments = documents.map((doc) => {
    const lines = String(doc.content || '').split('\n');
    const cleanLines = lines.filter((line) => !re.test(line));
    if (cleanLines.length !== lines.length) {
      infectedDocs.push(doc.path || 'unknown_doc');
    }
    return { ...doc, content: cleanLines.join('\n') };
  });

  return {
    virusId,
    infectedSeatsCount: infectedSeats.length,
    infectedDocsCount: infectedDocs.length,
    infectedSeats,
    infectedDocs,
    cleanedSeats,
    cleanedDocuments,
    inoculationRule: {
      gateId: `inoculate-${virusId}`,
      action: 'deny',
      pattern: re.source,
      message: `Blocked re-introduction of purged mind-virus pattern (${virusId}).`,
    },
  };
}

/**
 * Pillar 5: Agent Productivity Monitoring (APM) — Ceremony-to-Progress Ratio.
 */
function evaluateCeremonyToProgress({
  rigName = 'core-rig',
  ceremonyEvents = 0,
  completedSlices = 0,
  maxRatio = 4.0,
  stallThreshold = 5,
  rigContext = {},
} = {}) {
  const ceremony = Math.max(0, Number(ceremonyEvents) || 0);
  const progress = Math.max(0, Number(completedSlices) || 0);
  const ratio = progress === 0 ? (ceremony > 0 ? Infinity : 0) : Number((ceremony / progress).toFixed(2));
  const stalled = (progress === 0 && ceremony >= stallThreshold) || (progress > 0 && ratio > maxRatio);

  return {
    rigName,
    ceremonyEvents: ceremony,
    completedSlices: progress,
    ceremonyToProgressRatio: ratio === Infinity ? 'INFINITY_ZERO_PROGRESS' : ratio,
    status: stalled ? 'bureaucracy_loop_alert' : 'healthy_progress',
    alertTriggered: stalled,
    triageDispatch: stalled
      ? {
          targetSeat: `triage@${rigName}`,
          reason: progress === 0 ? 'zero_slice_progress_under_ceremony_load' : 'ceremony_to_progress_ratio_exceeded',
          bundledContext: {
            rigName,
            ceremonyEvents: ceremony,
            completedSlices: progress,
            ...rigContext,
          },
        }
      : null,
  };
}

function buildHerdrCivilizationReport(options = {}) {
  const pluginCheck = verifyHerdrPlugin();
  const findings = [];
  if (!pluginCheck.ok) {
    findings.push({ id: 'herdr-plugin-invalid', message: pluginCheck.error });
  }
  return {
    ok: findings.length === 0,
    status: findings.length === 0 ? 'ready' : 'fail',
    sourceUrl: SOURCE_URL,
    gateId: GATE_ID,
    plugin: pluginCheck,
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
  if (args['herdr-civilization'] || args['map-only'] || args.json) {
    const report = buildHerdrCivilizationReport(args);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.ok ? 0 : 1;
  }
  const res = verifyHerdrPlugin();
  process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
  return res.ok ? 0 : 1;
}

if (process.argv[1] && require('node:path').resolve(process.argv[1]) === require('node:path').resolve(__filename)) {
  const code = runCli(process.argv.slice(2));
  process.exit(code);
}

module.exports = {
  verifyHerdrPlugin,
  MANIFEST_PATH,
  SOURCE_URL,
  GATE_ID,
  RAIL_MAP,
  buildAgentSeat,
  occupySeatSession,
  buildRigPod,
  buildThreeAltitudeGraph,
  advanceWorkflowHarness,
  buildRefocusInjection,
  evaluateAltitudeBridgedApproval,
  traceAndPurgeMindVirus,
  evaluateCeremonyToProgress,
  buildHerdrCivilizationReport,
  runCli,
};
