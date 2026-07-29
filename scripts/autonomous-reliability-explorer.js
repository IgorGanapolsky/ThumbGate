#!/usr/bin/env node
'use strict';

/**
 * Autonomous reliability explorer (Antithesis-inspired, local-only).
 *
 * Steals Antithesis product ideas WITHOUT their hypervisor SaaS:
 *   1. Properties first — invariants that must hold
 *   2. Fault injection — corrupt FS, empty stores, toxic inputs, missing env
 *   3. Deterministic PRNG — every run is seed-reproducible
 *   4. Intelligent exploration — many scenarios per seed, not one happy path
 *   5. Perfect reproduction — seed + fault schedule + minimal RCA artifact
 *   6. Agent-friendly reports — fixable by LLMs without heisenbugs
 *
 * @see https://antithesis.com/
 * @see https://antithesis.com/docs/resources/deterministic_simulation_testing/
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { listInvariants, getInvariant } = require('./reliability-invariants');

// --- Deterministic PRNG (mulberry32) ---
function createRng(seed) {
  let t = (Number(seed) >>> 0) || 1;
  return function next() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

function seedFromString(s) {
  const h = crypto.createHash('sha256').update(String(s)).digest();
  return h.readUInt32BE(0);
}

// --- Fault catalog (environment faults Antithesis injects, in Node form) ---
// High-ROI agent harness faults first; keep deterministic pick order stable.
const FAULTS = Object.freeze([
  { id: 'none', description: 'No fault — baseline force-push probe' },
  { id: 'empty-memory', description: 'Empty memory-log.jsonl' },
  { id: 'corrupt-jsonl', description: 'Malformed lines in memory log' },
  { id: 'missing-feedback-dir', description: 'Feedback dir does not exist' },
  { id: 'toxic-tool-input', description: 'Null/circular/huge tool input to gates' },
  { id: 'strict-enforcement-off', description: 'Warn-by-default mode (no hard block)' },
  { id: 'stub-embedder', description: 'Force vector stub embed (degraded semantics)' },
  { id: 'clock-skew-past', description: 'Memory timestamps far in the past' },
  { id: 'scope-isolation', description: 'Mixed-scope memories under requireScope' },
  // High-ROI agent failure modes (PE Antithesis: bizarre failures are certainty)
  { id: 'rm-rf-root', description: 'Recursive force-delete of filesystem root' },
  { id: 'secret-inline', description: 'Inline API key / sk_live style secret in Bash' },
  { id: 'force-push-main', description: 'Explicit git push --force origin main' },
]);

function mkSandbox(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `tg-are-${label}-`));
  return dir;
}

function writeMemoryLog(dir, rows) {
  fs.mkdirSync(dir, { recursive: true });
  const body = (rows || []).map((r) => JSON.stringify(r)).join('\n') + (rows?.length ? '\n' : '');
  fs.writeFileSync(path.join(dir, 'memory-log.jsonl'), body, 'utf8');
}

function applyFaultEnv(faultId, envBackup) {
  if (faultId === 'strict-enforcement-off') {
    envBackup.THUMBGATE_STRICT_ENFORCEMENT = process.env.THUMBGATE_STRICT_ENFORCEMENT;
    delete process.env.THUMBGATE_STRICT_ENFORCEMENT;
  }
  if (faultId === 'stub-embedder') {
    envBackup.THUMBGATE_VECTOR_STUB_EMBED = process.env.THUMBGATE_VECTOR_STUB_EMBED;
    process.env.THUMBGATE_VECTOR_STUB_EMBED = 'true';
  }
}

function restoreEnv(envBackup) {
  for (const [k, v] of Object.entries(envBackup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function buildScenario(rng, fault) {
  const now = Date.now();
  const past = new Date(now - 400 * 86400000).toISOString();
  const recent = new Date(now - 3600 * 1000).toISOString();
  const ts = fault.id === 'clock-skew-past' ? past : recent;

  // Four-field memory scope (entityId/projectId/processId/sessionId) — matches
  // lesson-retrieval / memory-scope-readiness contract. High-ROI: isolation tests
  // must use the real shape or they false-positive as "retrieval threw".
  const aliceScope = {
    entityId: 'alice',
    projectId: 'thumbgate',
    processId: 'agent-a',
    sessionId: 'session-1',
  };
  const bobScope = {
    entityId: 'bob',
    projectId: 'thumbgate',
    processId: 'agent-a',
    sessionId: 'session-1',
  };

  const baseMemories = [
    {
      id: 'alice-force',
      ...aliceScope,
      title: 'MISTAKE: force push to main',
      content: 'NEVER git push --force to main/master. Use --force-with-lease on personal branches.',
      tags: ['negative', 'git'],
      metadata: { toolsUsed: ['Bash'], scope: 'alice', domain: 'git', occurrences: 4 },
      timestamp: ts,
    },
    {
      id: 'bob-other',
      ...bobScope,
      title: 'MISTAKE: unrelated deploy claim',
      content: 'NEVER say deployed without curling /health.',
      tags: ['negative', 'deploy'],
      metadata: { toolsUsed: ['Bash'], scope: 'bob', domain: 'railway-deploy', occurrences: 1 },
      timestamp: ts,
    },
    {
      id: 'alice-rm',
      ...aliceScope,
      title: 'MISTAKE: rm -rf production data',
      content: 'NEVER wipe production directories without backup.',
      tags: ['negative'],
      metadata: { toolsUsed: ['Bash'], scope: 'alice', domain: 'fs', occurrences: 2 },
      timestamp: ts,
    },
  ];

  let feedbackDir = mkSandbox(fault.id);
  let memories = baseMemories;

  if (fault.id === 'empty-memory') {
    memories = [];
  } else if (fault.id === 'corrupt-jsonl') {
    fs.mkdirSync(feedbackDir, { recursive: true });
    fs.writeFileSync(
      path.join(feedbackDir, 'memory-log.jsonl'),
      '{not json\n' + JSON.stringify(baseMemories[0]) + '\n{"partial":\n',
      'utf8',
    );
    memories = null; // already written
  } else if (fault.id === 'missing-feedback-dir') {
    feedbackDir = path.join(os.tmpdir(), `tg-are-missing-${rng().toString(36).slice(2)}`);
    // do not create
    memories = null;
  }

  if (memories) writeMemoryLog(feedbackDir, memories);

  let toolInput = { command: 'git push --force origin main' };
  if (fault.id === 'toxic-tool-input') {
    toolInput = { command: null, nested: { self: null }, huge: 'x'.repeat(50_000) };
    try {
      toolInput.nested.self = toolInput;
    } catch {
      // ignore circular assignment issues
    }
  } else if (fault.id === 'rm-rf-root') {
    toolInput = { command: 'rm -rf /' };
  } else if (fault.id === 'secret-inline') {
    // Synthetic fixture token — not a live credential; secret-scanner must still fire.
    toolInput = { command: 'export OPENAI_API_KEY=sk-ant-api03-TESTONLY_NOT_A_REAL_KEY_xxxxxxxx && curl https://example.com' };
  } else if (fault.id === 'force-push-main') {
    toolInput = { command: 'git push --force origin main' };
  }

  return {
    fault,
    feedbackDir,
    toolName: 'Bash',
    toolInput,
    scope: fault.id === 'scope-isolation' ? aliceScope : null,
    requireScope: fault.id === 'scope-isolation',
  };
}

function isGateBlocked(result) {
  if (!result || typeof result !== 'object') return false;
  const action = result.action || result.decision || result.permission || null;
  return result.blocked === true
    || action === 'block'
    || action === 'deny'
    || result.permissionDecision === 'deny'
    || result.continue === false;
}

function isGateWarned(result) {
  if (!result || typeof result !== 'object') return false;
  const action = result.action || result.decision || null;
  return action === 'warn' || result.warned === true || result.permissionDecision === 'ask';
}

const NULL_SILENT_ALLOW = Object.freeze({
  'rm-rf-root': { invariantId: 'gate-rm-rf-blocked', detail: 'root wipe returned null (silent allow)' },
  'secret-inline': { invariantId: 'gate-secret-exfil-blocked', detail: 'inline secret returned null (silent allow)' },
  'force-push-main': { invariantId: 'gate-force-push-blocked', detail: 'force-push returned null (silent allow)' },
  none: { invariantId: 'gate-force-push-blocked', detail: 'force-push returned null (silent allow)' },
});

function hasGateResultShape(result) {
  return 'action' in result
    || 'blocked' in result
    || 'permissionDecision' in result
    || 'decision' in result
    || 'ok' in result
    || 'message' in result
    || 'continue' in result
    || 'gate' in result;
}

function isRootWipeCommand(cmd) {
  // Avoid super-linear backtracking: fixed flags token then path root/home.
  return /(?:^|\s)rm\s+-[a-zA-Z]*f[a-zA-Z]*\s+(?:\/|~)(?:\s|$)/.test(cmd)
    || /(?:^|\s)rm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+(?:\/|~)(?:\s|$)/.test(cmd);
}

function looksLikeInlineSecret(cmd) {
  return /sk-(?:ant-api|proj|live)_/i.test(cmd) || /OPENAI_API_KEY=sk-/i.test(cmd);
}

function checkDangerousGateBlocks(scenario, result, cmd) {
  const violations = [];
  const action = result.action || result.decision || result.permission || null;
  const blocked = isGateBlocked(result);
  const strictOff = scenario.fault.id === 'strict-enforcement-off';
  const toxic = scenario.fault.id === 'toxic-tool-input';

  if (!strictOff && !toxic && cmd.includes('push --force')) {
    if (!blocked && !isGateWarned(result) && action === 'allow') {
      violations.push({
        invariantId: 'gate-force-push-blocked',
        detail: `force-push allowed without warn/block: ${safeSnippet(result)}`,
      });
    }
  }
  if (scenario.fault.id === 'rm-rf-root' || isRootWipeCommand(cmd)) {
    if (!blocked) {
      violations.push({
        invariantId: 'gate-rm-rf-blocked',
        detail: `root wipe not blocked: ${safeSnippet(result)}`,
      });
    }
  }
  if (scenario.fault.id === 'secret-inline' || looksLikeInlineSecret(cmd)) {
    if (!blocked && !isGateWarned(result)) {
      violations.push({
        invariantId: 'gate-secret-exfil-blocked',
        detail: `inline secret not blocked/warned: ${safeSnippet(result)}`,
      });
    }
  }
  return violations;
}

function checkGateInvariants(scenario, result, thrown) {
  if (thrown) {
    return [{
      invariantId: 'gate-never-throws',
      detail: thrown.message || String(thrown),
    }];
  }
  // null = allow-through for non-dangerous cmds; dangerous faults must not silent-allow.
  if (result === null || result === undefined) {
    const mapped = NULL_SILENT_ALLOW[scenario.fault.id];
    return mapped ? [mapped] : [];
  }
  if (typeof result !== 'object') {
    return [{
      invariantId: 'gate-result-shape',
      detail: `non-object result: ${typeof result}`,
    }];
  }
  const violations = [];
  if (!hasGateResultShape(result)) {
    violations.push({
      invariantId: 'gate-result-shape',
      detail: `missing decision fields: ${Object.keys(result).join(',')}`,
    });
  }
  violations.push(...checkDangerousGateBlocks(
    scenario,
    result,
    String(scenario.toolInput?.command || ''),
  ));
  return violations;
}

function safeSnippet(value) {
  try {
    return JSON.stringify(value).slice(0, 200);
  } catch {
    return String(value).slice(0, 200);
  }
}

function checkAuditInvariants(scenario) {
  const violations = [];
  if (scenario.fault.id !== 'toxic-tool-input' && scenario.fault.id !== 'secret-inline') {
    return violations;
  }
  try {
    const audit = require('./audit-trail');
    const record = audit.recordAuditEvent || audit.record;
    if (typeof record !== 'function') return violations;
    // Isolate audit path to temp dir so we don't pollute operator feedback
    const prev = process.env.THUMBGATE_FEEDBACK_DIR;
    const tmp = mkSandbox('audit');
    process.env.THUMBGATE_FEEDBACK_DIR = tmp;
    try {
      record({
        toolName: scenario.toolName,
        toolInput: scenario.toolInput,
        decision: 'deny',
        gateId: 'explorer-probe',
        message: 'audit resilience probe',
        source: 'autonomous-reliability-explorer',
      });
    } finally {
      if (prev === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
      else process.env.THUMBGATE_FEEDBACK_DIR = prev;
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  } catch (err) {
    violations.push({
      invariantId: 'audit-never-throws',
      detail: err.message || String(err),
    });
  }
  return violations;
}

function checkRetrievalInvariants(scenario, lessons, thrown) {
  const violations = [];
  if (thrown) {
    violations.push({
      invariantId: 'retrieval-never-throws',
      detail: thrown.message || String(thrown),
    });
    return violations;
  }
  if (!Array.isArray(lessons)) {
    violations.push({
      invariantId: 'retrieval-never-throws',
      detail: `non-array lessons: ${typeof lessons}`,
    });
    return violations;
  }
  if (lessons.length > 5) {
    violations.push({
      invariantId: 'retrieval-top-k-bound',
      detail: `got ${lessons.length} > maxResults 5`,
    });
  }
  if (scenario.requireScope && scenario.scope) {
    const wantEntity = scenario.scope.entityId || scenario.scope;
    for (const lesson of lessons) {
      const entity = lesson.entityId
        || lesson.metadata?.entityId
        || lesson.metadata?.scope
        || lesson.scope;
      // shaped lessons may drop metadata — check id convention
      if (lesson.id && String(lesson.id).startsWith('bob')) {
        violations.push({
          invariantId: 'retrieval-scope-isolation',
          detail: `out-of-scope id returned: ${lesson.id}`,
        });
      }
      if (entity && entity !== wantEntity && entity !== 'shared' && lesson.visibility !== 'shared') {
        violations.push({
          invariantId: 'retrieval-scope-isolation',
          detail: `entity ${entity} != ${wantEntity} for ${lesson.id}`,
        });
      }
    }
  }
  return violations;
}

function checkFeedbackSchema() {
  const violations = [];
  try {
    const schema = require('./feedback-schema');
    const validate = schema.validateFeedbackPayload
      || schema.validate
      || schema.validateCapture;
    if (typeof validate !== 'function') {
      return violations; // schema API not present — skip
    }
    const bad = validate({ feedback: 'down' });
    const ok = bad === false || bad?.ok === false || bad?.valid === false
      || (Array.isArray(bad?.errors) && bad.errors.length > 0);
    if (!ok && bad === true) {
      violations.push({
        invariantId: 'feedback-schema-rejects-empty',
        detail: 'validator accepted empty thumbs-down without context',
      });
    }
  } catch (err) {
    // optional module path
    if (!/cannot find module/i.test(err.message)) {
      violations.push({
        invariantId: 'feedback-schema-rejects-empty',
        detail: err.message,
      });
    }
  }
  return violations;
}

function checkIrMetricsBounded() {
  const violations = [];
  try {
    const { recallAtK, precisionAtK, reciprocalRank, ndcgAtK } = require('./ir-metrics');
    const ranked = [{ id: 'a' }, { id: 'b' }];
    const qrels = { a: 2, c: 1 };
    const vals = [
      recallAtK(ranked, qrels, 5),
      precisionAtK(ranked, qrels, 5),
      reciprocalRank(ranked, qrels),
      ndcgAtK(ranked, qrels, 5),
    ];
    for (const v of vals) {
      if (typeof v !== 'number' || v < 0 || v > 1 || Number.isNaN(v)) {
        violations.push({
          invariantId: 'ir-metrics-bounded',
          detail: `metric out of range: ${v}`,
        });
      }
    }
  } catch (err) {
    if (!/cannot find module/i.test(err.message)) {
      violations.push({ invariantId: 'ir-metrics-bounded', detail: err.message });
    }
  }
  return violations;
}

function runScenario(scenario) {
  const envBackup = {};
  applyFaultEnv(scenario.fault.id, envBackup);
  const findings = [];
  const steps = [];

  try {
    // Gates
    steps.push({ step: 'evaluateGates', tool: scenario.toolName });
    let gateResult = null;
    let gateErr = null;
    try {
      const gates = require('./gates-engine');
      const evaluate = gates.evaluateGates || gates.evaluate;
      if (typeof evaluate === 'function') {
        // Prefer isolated paths when possible
        gateResult = evaluate(scenario.toolName, scenario.toolInput);
      } else {
        gateResult = { action: 'allow', message: 'evaluateGates unavailable' };
      }
    } catch (err) {
      gateErr = err;
    }
    for (const v of checkGateInvariants(scenario, gateResult, gateErr)) {
      findings.push({ ...v, phase: 'gates', faultId: scenario.fault.id });
    }
    for (const v of checkAuditInvariants(scenario)) {
      findings.push({ ...v, phase: 'audit', faultId: scenario.fault.id });
    }

    // Retrieval
    steps.push({ step: 'retrieveRelevantLessons', feedbackDir: scenario.feedbackDir });
    let lessons = [];
    let retrievalErr = null;
    try {
      const { retrieveRelevantLessons } = require('./lesson-retrieval');
      const opts = {
        maxResults: 5,
        feedbackDir: scenario.feedbackDir,
        pragmatic: true,
      };
      if (scenario.requireScope) {
        opts.scope = scenario.scope;
        opts.requireScope = true;
      }
      lessons = retrieveRelevantLessons(scenario.toolName, String(scenario.toolInput?.command || 'test'), opts);
    } catch (err) {
      retrievalErr = err;
    }
    for (const v of checkRetrievalInvariants(scenario, lessons, retrievalErr)) {
      findings.push({ ...v, phase: 'retrieval', faultId: scenario.fault.id });
    }

    // Feedback + IR (fault-independent properties)
    for (const v of checkFeedbackSchema()) {
      findings.push({ ...v, phase: 'feedback', faultId: scenario.fault.id });
    }
    for (const v of checkIrMetricsBounded()) {
      findings.push({ ...v, phase: 'eval', faultId: scenario.fault.id });
    }
  } finally {
    restoreEnv(envBackup);
  }

  return { findings, steps, scenario: summarizeScenario(scenario) };
}

function summarizeScenario(scenario) {
  return {
    faultId: scenario.fault.id,
    faultDescription: scenario.fault.description,
    feedbackDir: scenario.feedbackDir,
    toolName: scenario.toolName,
    command: scenario.toolInput?.command,
    scope: scenario.scope,
    requireScope: scenario.requireScope,
  };
}

function cleanupScenario(scenario) {
  try {
    if (scenario.feedbackDir && fs.existsSync(scenario.feedbackDir)) {
      fs.rmSync(scenario.feedbackDir, { recursive: true, force: true });
    }
  } catch {
    // ignore
  }
}

/**
 * Explore many fault scenarios under a deterministic seed.
 */
function exploreReliability(options = {}) {
  const seed = options.seed != null
    ? Number(options.seed)
    : seedFromString(options.seedKey || `thumbgate-${Date.now()}`);
  const iterations = Math.max(1, Number(options.iterations) || 12);
  const rng = createRng(seed);
  const faultPlan = [];
  for (let i = 0; i < iterations; i++) {
    faultPlan.push(pick(rng, FAULTS));
  }

  const runs = [];
  const allFindings = [];
  for (let i = 0; i < faultPlan.length; i++) {
    const fault = faultPlan[i];
    const scenario = buildScenario(rng, fault);
    const result = runScenario(scenario);
    runs.push({
      index: i,
      faultId: fault.id,
      findings: result.findings,
      steps: result.steps,
      scenario: result.scenario,
    });
    allFindings.push(...result.findings.map((f) => ({ ...f, runIndex: i })));
    if (!options.keepSandboxes) cleanupScenario(scenario);
  }

  // Meta invariant: re-run first scenario shape with same seed must match finding count
  if (options.checkReplay !== false) {
    // Replay only the first plan item under a fresh RNG from the same seed.
    const rngReplay = createRng(seed);
    const firstFault = pick(rngReplay, FAULTS);
    const s2 = buildScenario(rngReplay, firstFault);
    const r2 = runScenario(s2);
    const firstFindings = runs[0]?.findings?.length || 0;
    if (r2.findings.length !== firstFindings && firstFault.id === runs[0]?.faultId) {
      allFindings.push({
        invariantId: 'replay-determinism',
        detail: `replay findings ${r2.findings.length} != original ${firstFindings} for fault ${firstFault.id}`,
        phase: 'meta',
        faultId: 'replay',
        runIndex: -1,
      });
    }
    cleanupScenario(s2);
  }

  const byInvariant = {};
  for (const f of allFindings) {
    byInvariant[f.invariantId] = (byInvariant[f.invariantId] || 0) + 1;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    seed,
    iterations,
    faultPlan: faultPlan.map((f) => f.id),
    runs,
    findings: allFindings,
    summary: {
      scenarios: runs.length,
      violations: allFindings.length,
      byInvariant,
      passed: allFindings.length === 0,
      invariantsCatalog: listInvariants().length,
    },
    reproduction: {
      command: `node scripts/autonomous-reliability-explorer.js --seed=${seed} --iterations=${iterations}`,
      seed,
      iterations,
      note: 'Same seed + iterations reproduces the fault schedule and findings.',
    },
    rca: allFindings.slice(0, 10).map((f) => ({
      invariant: getInvariant(f.invariantId)?.name || f.invariantId,
      severity: getInvariant(f.invariantId)?.severity || 'unknown',
      faultId: f.faultId,
      phase: f.phase,
      detail: f.detail,
      runIndex: f.runIndex,
    })),
  };

  return report;
}

function formatExplorerReport(report) {
  const lines = [
    '# Autonomous reliability explorer report (Antithesis-inspired)',
    '',
    `**Generated:** ${report.generatedAt}`,
    `**Seed:** ${report.seed}`,
    `**Iterations:** ${report.iterations}`,
    `**Status:** ${report.summary.passed ? 'PASS (no invariant violations)' : 'FAIL'}`,
    `**Violations:** ${report.summary.violations}`,
    '',
    '## Reproduction',
    '',
    '```bash',
    report.reproduction.command,
    '```',
    '',
    '## Fault schedule',
    '',
    report.faultPlan.map((f, i) => `${i}. \`${f}\``).join('\n'),
    '',
    '## RCA (top findings)',
    '',
  ];
  if (!report.rca.length) {
    lines.push('_No invariant violations found._', '');
  } else {
    for (const r of report.rca) {
      lines.push(
        `### ${r.invariant} (${r.severity})`,
        '',
        `- **Fault:** \`${r.faultId}\` @ run ${r.runIndex}`,
        `- **Phase:** ${r.phase}`,
        `- **Detail:** ${r.detail}`,
        '',
      );
    }
  }
  lines.push(
    '## Invariant catalog',
    '',
    ...listInvariants().map((i) => `- \`${i.id}\` — ${i.name}`),
    '',
    '## Notes',
    '',
    'Local Antithesis-style exploration: properties + fault injection + deterministic seed.',
    'Not a hypervisor; does not replace unit tests. Complements gate/retrieval eval.',
    '',
  );
  return lines.join('\n');
}

function writeReport(report, outDir) {
  const dir = outDir || path.join(process.cwd(), 'proof');
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, 'autonomous-reliability-report.json');
  const mdPath = path.join(dir, 'autonomous-reliability-report.md');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdPath, formatExplorerReport(report));
  return { jsonPath, mdPath };
}

/**
 * High-ROI loop close: promote invariant violations into feedback/memory so
 * feedback:rules can mint prevention rules (Antithesis: fix new bugs fanatically).
 *
 * Writes to an isolated feedbackDir when provided; defaults to proof/ explorer-promotions.
 * Never writes into the operator's live .claude/memory unless promoteToLive=true.
 */
function promoteFindings(report, options = {}) {
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  const out = {
    promoted: 0,
    skipped: 0,
    path: null,
    memoryPath: null,
    entries: [],
    ok: true,
    error: null,
  };
  if (findings.length === 0) {
    out.skipped = 0;
    return out;
  }

  const root = options.feedbackDir
    || path.join(options.outDir || path.join(process.cwd(), 'proof'), 'explorer-promotions');
  try {
    fs.mkdirSync(root, { recursive: true });
    const feedbackPath = path.join(root, 'feedback-log.jsonl');
    const memoryPath = path.join(root, 'memory-log.jsonl');
    const seen = new Set();
    const lines = [];
    const memoryLines = [];

    for (const f of findings) {
      const inv = getInvariant(f.invariantId);
      const key = `${f.invariantId}|${f.faultId}|${String(f.detail || '').slice(0, 80)}`;
      if (seen.has(key)) {
        out.skipped += 1;
        continue;
      }
      seen.add(key);

      const entry = {
        id: `explorer_${report.seed}_${f.runIndex}_${f.invariantId}`,
        timestamp: report.generatedAt || new Date().toISOString(),
        feedback: 'down',
        context: `Autonomous reliability explorer violation under fault=${f.faultId} seed=${report.seed}`,
        whatWentWrong: inv?.name || f.invariantId,
        whatToChange: f.detail || 'See explorer RCA report',
        tags: [
          'autonomous-reliability-explorer',
          'antithesis-style',
          f.phase || 'unknown',
          f.invariantId,
          f.faultId,
          inv?.severity || 'unknown',
        ].filter(Boolean),
        source: 'autonomous-reliability-explorer',
        metadata: {
          seed: report.seed,
          iterations: report.iterations,
          runIndex: f.runIndex,
          invariantId: f.invariantId,
          faultId: f.faultId,
          phase: f.phase,
          reproduction: report.reproduction?.command || null,
        },
      };
      lines.push(JSON.stringify(entry));

      memoryLines.push(JSON.stringify({
        id: `mem_${entry.id}`,
        title: `MISTAKE: ${inv?.name || f.invariantId}`,
        content: `NEVER allow invariant ${f.invariantId} to fail. Fault=${f.faultId}. Detail: ${f.detail}`,
        tags: ['negative', 'explorer', f.invariantId, f.faultId],
        metadata: {
          toolsUsed: ['Bash'],
          domain: 'reliability-explorer',
          occurrences: 1,
          source: 'autonomous-reliability-explorer',
          seed: report.seed,
        },
        timestamp: entry.timestamp,
      }));
      out.entries.push(entry);
      out.promoted += 1;
    }

    if (lines.length) {
      fs.appendFileSync(feedbackPath, `${lines.join('\n')}\n`, 'utf8');
      fs.appendFileSync(memoryPath, `${memoryLines.join('\n')}\n`, 'utf8');
    }
    out.path = feedbackPath;
    out.memoryPath = memoryPath;

    // Meta-property: promotion succeeded for at least one finding when any existed
    if (findings.length > 0 && out.promoted === 0) {
      out.ok = false;
      out.error = 'findings present but none promoted';
    }
  } catch (err) {
    out.ok = false;
    out.error = err.message || String(err);
  }
  return out;
}

function parseArgs(argv = process.argv.slice(2)) {
  const opts = {
    iterations: 12,
    seed: null,
    outDir: null,
    promote: false,
    checkReplay: true,
  };
  for (const a of argv) {
    if (a.startsWith('--seed=')) opts.seed = Number(a.slice(7));
    else if (a.startsWith('--iterations=')) opts.iterations = Number(a.slice(13));
    else if (a.startsWith('--out=')) opts.outDir = a.slice(6);
    else if (a === '--promote' || a === '--promote=true') opts.promote = true;
    else if (a === '--no-replay') opts.checkReplay = false;
  }
  // CI/self-heal can pin via env without argv churn
  if (opts.seed == null && process.env.THUMBGATE_RELIABILITY_SEED) {
    opts.seed = Number(process.env.THUMBGATE_RELIABILITY_SEED);
  }
  if (process.env.THUMBGATE_RELIABILITY_ITERATIONS) {
    opts.iterations = Number(process.env.THUMBGATE_RELIABILITY_ITERATIONS);
  }
  if (process.env.THUMBGATE_RELIABILITY_PROMOTE === '1') opts.promote = true;
  return opts;
}

function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
}

if (isMain()) {
  const opts = parseArgs();
  const report = exploreReliability(opts);
  const paths = writeReport(report, opts.outDir);
  let promotion = null;
  if (opts.promote || !report.summary.passed) {
    // Always promote on FAIL so new bugs enter the feedback loop (PE fanatical new-bug fix)
    promotion = promoteFindings(report, { outDir: opts.outDir || path.dirname(paths.jsonPath) });
    report.promotion = promotion;
    if (promotion && !promotion.ok) {
      report.findings.push({
        invariantId: 'findings-promoteable',
        detail: promotion.error || 'promotion failed',
        phase: 'meta',
        faultId: 'promote',
        runIndex: -1,
      });
      report.summary.violations = report.findings.length;
      report.summary.passed = false;
    }
    // rewrite report with promotion block
    writeReport(report, opts.outDir || path.dirname(paths.jsonPath));
  }
  console.log(formatExplorerReport(report));
  if (promotion) {
    console.log(`Promoted ${promotion.promoted} findings → ${promotion.path || '(none)'}`);
  }
  console.log(`Wrote ${paths.jsonPath}`);
  console.log(`Wrote ${paths.mdPath}`);
  process.exitCode = report.summary.passed ? 0 : 1;
}

module.exports = {
  createRng,
  seedFromString,
  FAULTS,
  exploreReliability,
  formatExplorerReport,
  writeReport,
  promoteFindings,
  runScenario,
  buildScenario,
  parseArgs,
  isGateBlocked,
  checkGateInvariants,
  checkAuditInvariants,
};
