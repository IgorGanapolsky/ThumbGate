#!/usr/bin/env node
'use strict';

/**
 * Meta-Agent Loop — Automated Harness Self-Improvement
 *
 * Inspired by the "Auto Agent" architecture:
 *   - Task Agent does the work; Meta Agent observes outcomes and rewrites the harness.
 *
 * This runner closes the self-improvement loop without human feedback:
 *
 *   1. Read gate-program.md for the domain's success definition
 *   2. Pull recent failures from feedback-log.jsonl
 *   3. Generate N candidate rule mutations via LLM (or heuristic fallback)
 *   4. Evaluate each candidate by replaying it against the lesson DB:
 *        hit-rate  = failures it would have caught / total failures
 *        fp-rate   = successes it would have blocked / total successes
 *        score     = hit-rate - (fp_weight * fp-rate)
 *   5. Promote candidates whose score beats the current baseline
 *   6. Revert (discard) candidates that regress
 *   7. Write promoted rules to auto-promoted-gates.json + prevention-rules.md
 *   8. Record results in evolution-state.json with a rollback snapshot
 *
 * Runs autonomously at session end (Stop hook) or on demand:
 *   node scripts/meta-agent-loop.js
 *   node scripts/meta-agent-loop.js --dry-run
 *   node scripts/meta-agent-loop.js --status
 */

const fs = require('fs');
const path = require('path');
const { resolveFeedbackDir } = require('./feedback-paths');
const { parseFeedbackFile, classifySignal, promoteToGates } = require('./feedback-to-rules');
const { loadAutoGates, saveAutoGates, getAutoGatesPath, patternToGateId } = require('./auto-promote-gates');
const { readEvolutionState, writeEvolutionState, captureEvolutionSnapshot, applyAcceptedMutation } = require('./evolution-state');
const { isAvailable, callClaude, MODELS } = require('./llm-client');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GATE_PROGRAM_PATHS = [
  path.join(process.cwd(), 'gate-program.md'),
  path.join(process.cwd(), '..', 'gate-program.md'),
];

const CANDIDATES_PER_RUN = 5;
const FP_WEIGHT = 2.0;          // false positives penalised 2× vs true positives
const MIN_SCORE_THRESHOLD = 0.1; // candidate must score at least 0.1 to be promoted
const MAX_PROMOTED_PER_RUN = 3;  // at most 3 new rules per overnight run
const RECENT_WINDOW_DAYS = 14;   // look back 14 days for failures

const META_RUNS_PATH = path.join(
  require('os').homedir(),
  '.thumbgate',
  'meta-agent-runs.jsonl'
);

// ---------------------------------------------------------------------------
// 1. Read gate-program.md
// ---------------------------------------------------------------------------

function readGateProgram() {
  for (const p of GATE_PROGRAM_PATHS) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf-8');
    }
  }
  return null;
}

function extractSuccessDefinition(gateProgramText) {
  if (!gateProgramText) return '';
  const match = gateProgramText.match(/## Success Looks Like([\s\S]*?)(?=##|$)/);
  return match ? match[1].trim() : '';
}

function extractBlockPatterns(gateProgramText) {
  if (!gateProgramText) return [];
  const match = gateProgramText.match(/## Patterns to Block[\s\S]*?\n([\s\S]*?)(?=##|$)/);
  if (!match) return [];
  return match[1]
    .split('\n')
    .filter((l) => /^\d+\./.test(l.trim()))
    .map((l) => l.replace(/^\d+\.\s*\*\*[^*]+\*\*\s*—?\s*/, '').trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// 2. Pull recent failures
// ---------------------------------------------------------------------------

function getRecentFailures(feedbackLogPath, windowDays = RECENT_WINDOW_DAYS) {
  const entries = parseFeedbackFile(feedbackLogPath);
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;

  return entries.filter((e) => {
    if (classifySignal(e) !== 'negative') return false;
    const ts = e.timestamp ? new Date(e.timestamp).getTime() : 0;
    return ts >= cutoff;
  });
}

function getRecentSuccesses(feedbackLogPath, windowDays = RECENT_WINDOW_DAYS) {
  const entries = parseFeedbackFile(feedbackLogPath);
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;

  return entries.filter((e) => {
    if (classifySignal(e) !== 'positive') return false;
    const ts = e.timestamp ? new Date(e.timestamp).getTime() : 0;
    return ts >= cutoff;
  });
}

// ---------------------------------------------------------------------------
// 3. Candidate rule generation
// ---------------------------------------------------------------------------

const CANDIDATE_SYSTEM_PROMPT = `You are a meta-agent for ThumbGate, an AI coding agent safety system.

Your job: Given recent failure events and a domain success definition, generate
candidate prevention rules that would have caught these failures WITHOUT blocking
legitimate successful actions.

Return ONLY a JSON array of candidate rule objects (no markdown fences):
[
  {
    "pattern": "<JavaScript regex to match against tool call context/command>",
    "action": "block" | "warn",
    "message": "<why this is blocked/warned, shown to the agent>",
    "severity": "critical" | "high" | "medium",
    "rationale": "<why this rule would catch the failure pattern>"
  }
]

Rules:
- Pattern must be a valid JavaScript regex string (used with new RegExp(pattern, 'i'))
- Prefer specific patterns. "force.*push.*main" beats "push"
- Use "block" for destructive/irreversible actions, "warn" for review-needed
- Each rule should catch at least one of the listed failures
- Do NOT generate rules so broad they would block common, successful operations
- Max ${CANDIDATES_PER_RUN} candidates`;

async function generateCandidatesViaLLM(failures, successDef, blockPatterns) {
  if (!isAvailable()) return null;

  const failureBatch = failures
    .slice(0, 20)
    .map((e, i) => {
      const ctx = (e.context || e.whatWentWrong || '').slice(0, 200);
      const tags = (e.tags || []).join(', ');
      return `${i + 1}. ${ctx}${tags ? ` [tags: ${tags}]` : ''}`;
    })
    .join('\n');

  const userPrompt = [
    `## Success Definition\n${successDef || '(not specified)'}`,
    `## Known Block Patterns from gate-program.md\n${blockPatterns.map((p, i) => `${i + 1}. ${p}`).join('\n') || '(none)'}`,
    `## Recent Failures (${failures.length} total, showing up to 20)\n${failureBatch || '(none)'}`,
    `Generate ${CANDIDATES_PER_RUN} candidate prevention rules that would catch these failures.`,
  ].join('\n\n');

  const raw = await callClaude({
    systemPrompt: CANDIDATE_SYSTEM_PROMPT,
    userPrompt,
    model: MODELS.FAST,
    maxTokens: 1200,
  });

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((r) => r.pattern && r.action && r.message && r.severity)
      .slice(0, CANDIDATES_PER_RUN);
  } catch {
    return null;
  }
}

function generateCandidatesHeuristic(failures, blockPatterns) {
  // Fallback when no LLM is available: derive candidates from:
  //   (a) gate-program.md block patterns
  //   (b) top repeated failure contexts
  const candidates = [];

  // From gate-program.md block patterns
  for (const pattern of blockPatterns.slice(0, 3)) {
    const keywords = pattern
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 4)
      .slice(0, 3);
    if (keywords.length >= 2) {
      candidates.push({
        pattern: keywords.join('.*'),
        action: 'block',
        message: `Blocked by gate-program.md rule: ${pattern.slice(0, 80)}`,
        severity: 'high',
        rationale: 'Derived from gate-program.md block pattern',
        source: 'heuristic',
      });
    }
  }

  // From top repeated failure contexts
  const ctxCounts = {};
  for (const f of failures) {
    const ctx = (f.context || f.whatWentWrong || '').trim();
    if (ctx.length < 10) continue;
    const key = ctx.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').slice(0, 80);
    ctxCounts[key] = (ctxCounts[key] || 0) + 1;
  }

  const topContexts = Object.entries(ctxCounts)
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  for (const [ctx] of topContexts) {
    const keywords = ctx.split(/\s+/).filter((w) => w.length > 4).slice(0, 3);
    if (keywords.length >= 2) {
      candidates.push({
        pattern: keywords.join('.*'),
        action: 'warn',
        message: `Repeated failure pattern: ${ctx.slice(0, 80)}`,
        severity: 'medium',
        rationale: `Appeared ${ctxCounts[ctx]}× in recent failures`,
        source: 'heuristic',
      });
    }
  }

  return candidates.slice(0, CANDIDATES_PER_RUN);
}

// ---------------------------------------------------------------------------
// 4. Evaluate candidates
// ---------------------------------------------------------------------------

function matchesEntry(pattern, entry) {
  try {
    const re = new RegExp(pattern, 'i');
    const text = [
      entry.context,
      entry.whatWentWrong,
      entry.whatToChange,
      (entry.tags || []).join(' '),
    ].filter(Boolean).join(' ');
    return re.test(text);
  } catch {
    return false;
  }
}

function scoreCandidate(candidate, failures, successes) {
  if (!failures.length && !successes.length) return { score: 0, hitRate: 0, fpRate: 0 };

  const hits = failures.filter((f) => matchesEntry(candidate.pattern, f)).length;
  const fps = successes.filter((s) => matchesEntry(candidate.pattern, s)).length;

  const hitRate = failures.length > 0 ? hits / failures.length : 0;
  const fpRate = successes.length > 0 ? fps / successes.length : 0;
  const score = hitRate - FP_WEIGHT * fpRate;

  return { score, hitRate, fpRate, hits, fps };
}

// ---------------------------------------------------------------------------
// 5. Promote / revert
// ---------------------------------------------------------------------------

function buildPromotedGate(candidate, metrics, runId) {
  return {
    id: patternToGateId(`meta-${candidate.pattern}`),
    pattern: candidate.pattern,
    action: candidate.action,
    message: candidate.message,
    severity: candidate.severity,
    occurrences: metrics.hits,
    promotedAt: new Date().toISOString(),
    source: 'meta-agent',
    runId,
    score: parseFloat(metrics.score.toFixed(3)),
    hitRate: parseFloat(metrics.hitRate.toFixed(3)),
    fpRate: parseFloat(metrics.fpRate.toFixed(3)),
    rationale: candidate.rationale || '',
  };
}

function writePreventionRulesFromGates(autoGatesData, rulesPath) {
  const lines = [
    '# Prevention Rules (Meta-Agent Generated)',
    `# Updated: ${new Date().toISOString()}`,
    '',
  ];

  for (const gate of autoGatesData.gates) {
    const prefix = gate.action === 'block' ? '[BLOCK]' : '[WARN]';
    lines.push(`- ${prefix} ${gate.message}`);
  }

  if (!autoGatesData.gates.length) {
    lines.push('- No prevention rules active.');
  }

  const dir = path.dirname(rulesPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(rulesPath, lines.join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// 6. Persistence
// ---------------------------------------------------------------------------

function ensureDir(p) {
  if (!fs.existsSync(path.dirname(p))) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
  }
}

function appendRunManifest(manifest) {
  ensureDir(META_RUNS_PATH);
  fs.appendFileSync(META_RUNS_PATH, JSON.stringify(manifest) + '\n');
}

function readRunManifests() {
  if (!fs.existsSync(META_RUNS_PATH)) return [];
  const raw = fs.readFileSync(META_RUNS_PATH, 'utf-8').trim();
  if (!raw) return [];
  return raw.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// ---------------------------------------------------------------------------
// 7. Main entry point
// ---------------------------------------------------------------------------

async function runMetaAgentLoop({ dryRun = false, verbose = false } = {}) {
  const feedbackDir = resolveFeedbackDir();
  const feedbackLogPath = path.join(feedbackDir, 'feedback-log.jsonl');
  const autoGatesPath = getAutoGatesPath();
  const rulesPath = path.join(process.cwd(), '.thumbgate', 'prevention-rules.md');

  const runId = `meta_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const startedAt = new Date().toISOString();

  // Step 1: Read gate-program.md
  const gateProgramText = readGateProgram();
  const successDef = extractSuccessDefinition(gateProgramText);
  const blockPatterns = extractBlockPatterns(gateProgramText);

  if (verbose) {
    process.stdout.write(`[meta-agent] run=${runId}\n`);
    process.stdout.write(`[meta-agent] gate-program.md ${gateProgramText ? 'found' : 'NOT FOUND — using heuristics only'}\n`);
    process.stdout.write(`[meta-agent] block patterns from gate-program.md: ${blockPatterns.length}\n`);
  }

  // Step 2: Pull recent failures + successes
  const failures = getRecentFailures(feedbackLogPath);
  const successes = getRecentSuccesses(feedbackLogPath);

  if (verbose) {
    process.stdout.write(`[meta-agent] failures (${RECENT_WINDOW_DAYS}d): ${failures.length}, successes: ${successes.length}\n`);
  }

  // Step 3: Generate candidate rules
  let candidates = null;
  const analysisMode = isAvailable() ? 'llm' : 'heuristic';

  if (isAvailable()) {
    candidates = await generateCandidatesViaLLM(failures, successDef, blockPatterns);
  }
  if (!candidates || candidates.length === 0) {
    candidates = generateCandidatesHeuristic(failures, blockPatterns);
  }

  if (verbose) {
    process.stdout.write(`[meta-agent] candidates generated: ${candidates.length} (mode=${analysisMode})\n`);
  }

  // Step 4: Score each candidate
  const evaluated = candidates.map((c) => ({
    candidate: c,
    metrics: scoreCandidate(c, failures, successes),
  })).sort((a, b) => b.metrics.score - a.metrics.score);

  // Step 5: Select promotions
  const toPromote = evaluated
    .filter((e) => e.metrics.score >= MIN_SCORE_THRESHOLD)
    .slice(0, MAX_PROMOTED_PER_RUN);

  const toRevert = evaluated.filter((e) => e.metrics.score < MIN_SCORE_THRESHOLD);

  if (verbose) {
    process.stdout.write(`[meta-agent] candidates above threshold: ${toPromote.length}, below: ${toRevert.length}\n`);
    for (const { candidate, metrics } of evaluated) {
      const mark = metrics.score >= MIN_SCORE_THRESHOLD ? 'KEEP' : 'REVERT';
      process.stdout.write(
        `[meta-agent]   [${mark}] score=${metrics.score.toFixed(3)} hit=${metrics.hitRate.toFixed(2)} fp=${metrics.fpRate.toFixed(2)} — ${candidate.pattern}\n`
      );
    }
  }

  // Step 6: Persist promoted rules (unless dry-run)
  const promotedGates = [];

  if (!dryRun && toPromote.length > 0) {
    // Snapshot before mutating
    captureEvolutionSnapshot({
      label: `meta-agent-pre-${runId}`,
      reason: 'meta-agent-loop',
      source: 'meta-agent-loop',
      metadata: { runId, candidateCount: candidates.length, failureCount: failures.length },
    });

    const autoGatesData = loadAutoGates();

    for (const { candidate, metrics } of toPromote) {
      const gate = buildPromotedGate(candidate, metrics, runId);
      // Avoid duplicates by id
      const existingIdx = autoGatesData.gates.findIndex((g) => g.id === gate.id);
      if (existingIdx !== -1) {
        autoGatesData.gates[existingIdx] = { ...autoGatesData.gates[existingIdx], ...gate };
      } else {
        autoGatesData.gates.push(gate);
      }
      promotedGates.push(gate);
    }

    // Enforce max gates (10 free, rotate oldest)
    const MAX_GATES = 10;
    if (autoGatesData.gates.length > MAX_GATES) {
      autoGatesData.gates = autoGatesData.gates.slice(-MAX_GATES);
    }

    saveAutoGates(autoGatesData);
    writePreventionRulesFromGates(autoGatesData, rulesPath);

    // Record in evolution-state
    const state = readEvolutionState();
    writeEvolutionState({
      ...state,
      settings: {
        ...state.settings,
        last_meta_agent_run: runId,
        last_meta_agent_at: startedAt,
        meta_agent_total_promoted: (state.settings.meta_agent_total_promoted || 0) + toPromote.length,
      },
    });
  }

  const completedAt = new Date().toISOString();
  const manifest = {
    runId,
    startedAt,
    completedAt,
    dryRun,
    analysisMode,
    gateProgramFound: Boolean(gateProgramText),
    failureCount: failures.length,
    successCount: successes.length,
    candidateCount: candidates.length,
    promotedCount: toPromote.length,
    revertedCount: toRevert.length,
    promoted: promotedGates.map((g) => ({ id: g.id, action: g.action, score: g.score, pattern: g.pattern })),
    reverted: toRevert.map(({ candidate, metrics }) => ({
      pattern: candidate.pattern,
      score: parseFloat(metrics.score.toFixed(3)),
    })),
  };

  if (!dryRun) {
    appendRunManifest(manifest);
  }

  return manifest;
}

// ---------------------------------------------------------------------------
// 8. Status
// ---------------------------------------------------------------------------

function getMetaAgentStatus() {
  const runs = readRunManifests();
  if (runs.length === 0) return null;
  const last = runs[runs.length - 1];
  return {
    totalRuns: runs.length,
    lastRunId: last.runId,
    lastRunAt: last.completedAt,
    lastAnalysisMode: last.analysisMode,
    lastFailureCount: last.failureCount,
    lastCandidateCount: last.candidateCount,
    lastPromotedCount: last.promotedCount,
    lastRevertedCount: last.revertedCount,
    totalPromoted: runs.reduce((s, r) => s + (r.promotedCount || 0), 0),
  };
}

// ---------------------------------------------------------------------------
// 9. CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose') || args.includes('-v');

  if (args.includes('--status')) {
    const status = getMetaAgentStatus();
    if (!status) {
      console.log('No meta-agent runs recorded yet.');
    } else {
      console.log(JSON.stringify(status, null, 2));
    }
    return;
  }

  const mode = dryRun ? 'DRY RUN' : 'LIVE';
  console.log(`Meta-agent loop starting [${mode}]...`);

  const manifest = await runMetaAgentLoop({ dryRun, verbose: verbose || true });

  console.log(`Run ID        : ${manifest.runId}`);
  console.log(`Analysis mode : ${manifest.analysisMode}`);
  console.log(`Gate program  : ${manifest.gateProgramFound ? 'found' : 'not found'}`);
  console.log(`Failures (${RECENT_WINDOW_DAYS}d): ${manifest.failureCount}`);
  console.log(`Candidates    : ${manifest.candidateCount}`);
  console.log(`Promoted      : ${manifest.promotedCount}`);
  console.log(`Reverted      : ${manifest.revertedCount}`);

  if (manifest.promoted.length > 0) {
    console.log('\nPromoted rules:');
    for (const g of manifest.promoted) {
      console.log(`  [${g.action.toUpperCase()}] score=${g.score} — ${g.pattern}`);
    }
  }

  if (manifest.reverted.length > 0 && verbose) {
    console.log('\nReverted (below threshold):');
    for (const r of manifest.reverted) {
      console.log(`  score=${r.score} — ${r.pattern}`);
    }
  }

  if (dryRun) {
    console.log('\n[DRY RUN] No rules written.');
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Meta-agent loop failed:', err.message);
    process.exitCode = 1;
  });
}

module.exports = {
  runMetaAgentLoop,
  getMetaAgentStatus,
  readGateProgram,
  extractSuccessDefinition,
  extractBlockPatterns,
  getRecentFailures,
  getRecentSuccesses,
  generateCandidatesHeuristic,
  scoreCandidate,
  META_RUNS_PATH,
  CANDIDATES_PER_RUN,
  MIN_SCORE_THRESHOLD,
  FP_WEIGHT,
};
