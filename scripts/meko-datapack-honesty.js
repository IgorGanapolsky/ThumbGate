#!/usr/bin/env node
'use strict';

/**
 * Meko Data & Collective Memory FORMAT steal — not a product clone.
 *
 * Source: https://cloud.mekodata.ai/signup | https://mekodata.ai | https://docs.mekodata.ai
 * Backed by YugabyteDB (Distributed PostgreSQL).
 *
 * Transfers (process only):
 *   1. Five-plane agent-native data model:
 *      datapack (isolation unit) ≠ episodic memory ≠ promoted learnings ≠
 *      content-addressed artifacts ≠ decision traces.
 *   2. Promoted Learnings Protocol:
 *      Raw episodic conversation memory must undergo strict verification
 *      (rubric gate + feedback signal) before promotion into cross-agent learnings.
 *   3. Content-Addressed Artifact Attestation:
 *      Artifacts are hashed via SHA-256 for idempotent storage and cryptographic
 *      verification receipts across agent swarms.
 *   4. Decision & Reasoning Traces:
 *      Connects raw agent inputs and outputs to internal reasoning, plan steps,
 *      and token usage telemetry before state mutation.
 *
 * Maps onto existing ThumbGate rails (NOT a YugabyteDB / cloud.mekodata.ai dependency):
 *   datapack  → 4-field scope (entity, project, process, session) + eval registry
 *   memory    → feedback-log.jsonl + memory-log.jsonl + lesson-retrieval.js
 *   learning  → feedback-to-memory.js + rubric-engine.js + prevention-rules.md
 *   artifact  → action-receipts.js + verification-evidence.js
 *   trace     → decision-trace.js + agent-reasoning-traces.js + cli-telemetry.js
 *
 * Fail-closed honesty:
 *   - passive_store_without_firewall: Dumb memory without PreToolUse is a security hazard.
 *   - unverified_learning_promotion: memory_promote without rubric score fails closed.
 *   - plaintext_cloud_egress: Plaintext code/secrets to cloud.mekodata.ai denied.
 *   - unhashed_artifact_store: Artifacts without SHA-256 idempotency denied.
 *   - meko_clone_refused: Hard refusal of YugabyteDB cluster or third-party cloud lock-in.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SOURCE_URL = 'https://cloud.mekodata.ai/signup';

const PLANES = Object.freeze(['datapack', 'memory', 'learning', 'artifact', 'trace']);

const PLANE_RAILS = Object.freeze({
  datapack: {
    meko: 'Datapack — multi-tenant isolation unit grouping memory, conversation, knowledge bases, and artifacts',
    rails: [
      'scripts/memory-vs-rag-route.js (entity, project, process, session scoping)',
      'evals/ai-identity-checklist/registry.json',
      'scripts/task-scope-lease.js',
    ],
    when: 'Partitions agent state by tenant, workspace, or session without global contamination.',
  },
  memory: {
    meko: 'Episodic memory — working conversation context stored in distributed PostgreSQL + pgvector',
    rails: [
      'feedback-log.jsonl',
      'memory-log.jsonl',
      'scripts/feedback-schema.js',
      'scripts/lesson-retrieval.js',
    ],
    when: 'Captures raw session context and tool observations. Never accessed without firewall.',
  },
  learning: {
    meko: 'Learnings (memory_promote) — cross-agent compounded knowledge promoted from conversation',
    rails: [
      'scripts/feedback-to-memory.js',
      'scripts/rubric-engine.js',
      'scripts/thompson-sampling.js',
      'prevention-rules.md',
    ],
    when: 'Promotes mathematically verified mistakes into permanent negative constraints.',
  },
  artifact: {
    meko: 'Artifacts (artifact_put / artifact_get) — content-addressed SHA-256 file store',
    rails: [
      'scripts/action-receipts.js',
      'scripts/verification-evidence.js',
      'scripts/operator-artifacts.js',
    ],
    when: 'Guarantees that files referenced by agents are tamper-proof and verifiable by hash.',
  },
  trace: {
    meko: 'Traces & Telemetry — reasoning, plan, input, output, and token accounting per message',
    rails: [
      'scripts/decision-trace.js',
      'scripts/agent-reasoning-traces.js',
      'scripts/cli-telemetry.js',
    ],
    when: 'Maintains an auditable trail of agent deliberation before tool execution.',
  },
});

const CLONE_TRIGGERS = Object.freeze([
  'yugabyte',
  'yugabytedb',
  'cloud.mekodata.ai',
  'mcp.mekodata.ai',
  'meko-skills',
  'yugabyte/meko-skills',
]);

/**
 * Deterministically compute a SHA-256 hash for content-addressed artifacts.
 */
function hashArtifact(content) {
  if (content === null || content === undefined) {
    throw new TypeError('Content cannot be null or undefined');
  }
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Create a scoped datapack descriptor on existing ThumbGate rails.
 */
function createDatapackDescriptor({ id, name, scope, owner }) {
  if (!id || typeof id !== 'string') {
    throw new TypeError('Datapack descriptor requires a string id');
  }
  const cleanScope = {
    entity: scope?.entity || 'default-entity',
    project: scope?.project || 'default-project',
    process: scope?.process || 'default-process',
    session: scope?.session || 'default-session',
  };

  return {
    schemaVersion: 'thumbgate.meko-datapack.v1',
    id: String(id).trim(),
    name: name ? String(name).trim() : id,
    owner: owner || 'operator',
    scope: cleanScope,
    createdAt: new Date().toISOString(),
    planes: { ...PLANES },
  };
}

/**
 * Evaluate whether an episodic memory is eligible for promotion to a Learning.
 * Fails closed unless positive rubric delta and valid feedback signal exist.
 */
function evaluateMemoryPromotion({ memoryId, signal, rubricScore, domain }) {
  if (!memoryId) {
    return { promoted: false, reason: 'missing_memory_id' };
  }
  if (!signal || !['positive', 'negative', 'thumb_up', 'thumb_down'].includes(signal)) {
    return { promoted: false, reason: 'invalid_feedback_signal' };
  }
  if (typeof rubricScore !== 'number' || isNaN(rubricScore) || rubricScore < 0.70) {
    return { promoted: false, reason: 'rubric_score_insufficient', score: rubricScore };
  }
  if (!domain || typeof domain !== 'string') {
    return { promoted: false, reason: 'missing_domain_tag' };
  }

  return {
    promoted: true,
    learningId: `learn_${crypto.createHash('sha256').update(`${memoryId}:${domain}`).digest('hex').slice(0, 16)}`,
    memoryId,
    domain,
    rubricScore,
    promotedAt: new Date().toISOString(),
  };
}

/**
 * Detect clone or vendor-lock attempts against external Meko cloud or YugabyteDB.
 */
function detectCloneAttempt(text) {
  if (typeof text !== 'string') return null;
  const lower = text.toLowerCase();
  for (const trigger of CLONE_TRIGGERS) {
    if (lower.includes(trigger)) {
      return {
        forbidden: trigger,
        reason: 'Clone attempt refused: ThumbGate steals the FORMAT onto existing rails, not YugabyteDB or cloud.mekodata.ai.',
      };
    }
  }
  return null;
}

/**
 * Audit a datapack trace for compliance with the 5-plane honesty protocol.
 */
function auditTrace(trace, options = {}) {
  const findings = [];
  if (!trace || typeof trace !== 'object') {
    return {
      pass: false,
      findings: [{ code: 'invalid_trace', reason: 'Trace must be a non-null object' }],
      planesCovered: [],
    };
  }

  // 1. Hard clone check
  const cloneStr = JSON.stringify(trace);
  const clone = detectCloneAttempt(cloneStr);
  if (clone) {
    findings.push({
      code: 'meko_clone_refused',
      trigger: clone.forbidden,
      reason: clone.reason,
    });
  }

  // 2. Passive store without firewall check
  const hasStore = trace.hasMemoryStore || trace.tools?.some((t) => t.startsWith('memory_') || t.startsWith('datapack_'));
  const hasPreToolUseFirewall = trace.hasPreToolUseFirewall || trace.firewall === true || trace.gates?.includes('PreToolUse');
  if (hasStore && !hasPreToolUseFirewall) {
    findings.push({
      code: 'passive_store_without_firewall',
      reason: 'Memory or datapack store exists without an active PreToolUse firewall gate. Agents can retrieve toxic context and execute unchecked tools.',
    });
  }

  // 3. Unverified learning promotion check
  if (trace.promotions && Array.isArray(trace.promotions)) {
    for (const promo of trace.promotions) {
      const evalResult = evaluateMemoryPromotion(promo);
      if (!evalResult.promoted) {
        findings.push({
          code: 'unverified_learning_promotion',
          memoryId: promo.memoryId,
          reason: `memory_promote attempted without required rubric gate: ${evalResult.reason}`,
        });
      }
    }
  }

  // 4. Plaintext cloud egress check
  if (trace.cloudEgress === true || trace.remoteEndpoint?.includes('mekodata.ai')) {
    if (!trace.secretsRedacted) {
      findings.push({
        code: 'plaintext_cloud_egress',
        reason: 'Agent context or secrets routed to external cloud database without client-side redaction.',
      });
    }
  }

  // 5. Unhashed artifact storage check
  if (trace.artifacts && Array.isArray(trace.artifacts)) {
    for (const art of trace.artifacts) {
      if (!art.contentHash || !/^[a-f0-9]{64}$/i.test(art.contentHash)) {
        findings.push({
          code: 'unhashed_artifact_store',
          filename: art.filename,
          reason: 'Artifact stored without standard SHA-256 content address hash.',
        });
      }
    }
  }

  // 6. Complete 4-field scope check
  if (trace.datapack) {
    const s = trace.datapack.scope || {};
    const missing = ['entity', 'project', 'process', 'session'].filter((k) => !s[k]);
    if (missing.length > 0) {
      findings.push({
        code: 'incomplete_scope_partition',
        missing,
        reason: `Datapack isolation requires complete four-field scope. Missing: ${missing.join(', ')}`,
      });
    }
  }

  const planesCovered = PLANES.filter((p) => {
    if (p === 'datapack') return Boolean(trace.datapack);
    if (p === 'memory') return Boolean(trace.memories || trace.hasMemoryStore);
    if (p === 'learning') return Boolean(trace.promotions || trace.learnings);
    if (p === 'artifact') return Boolean(trace.artifacts);
    if (p === 'trace') return Boolean(trace.decisionTrace || trace.reasoning);
    return false;
  });

  return {
    pass: findings.length === 0,
    findings,
    planesCovered,
  };
}

/**
 * Build the full Meko Datapack honesty report.
 */
function buildMekoDatapackReport(options = {}) {
  const trace = options.trace ? JSON.parse(fs.readFileSync(options.trace, 'utf8')) : null;
  const audit = trace ? auditTrace(trace, options) : null;

  return {
    schemaVersion: 'thumbgate.meko-datapack-honesty.v1',
    timestamp: new Date().toISOString(),
    sourceUrl: SOURCE_URL,
    stealsFrom: 'Meko (cloud.mekodata.ai / YugabyteDB 2026)',
    doctrine: 'Collective Memory & Datapacks are FORMAT, not a YugabyteDB install. Steal the 5 planes onto existing ThumbGate rails.',
    planes: PLANES,
    planeRails: PLANE_RAILS,
    audit: audit || {
      pass: true,
      findings: [],
      planesCovered: [...PLANES],
      note: 'Map-only run. Pass --trace=<path> to audit a live multi-agent execution trace.',
    },
  };
}

/**
 * Format the report into a clean human-readable output.
 */
function formatMekoDatapackReport(report) {
  const lines = [];
  lines.push('=== Meko Datapack & Collective Memory Honesty Report ===');
  lines.push(`Source: ${report.sourceUrl}`);
  lines.push(`Doctrine: ${report.doctrine}`);
  lines.push('');
  lines.push('--- Five-Plane FORMAT Map ---');
  for (const plane of report.planes) {
    const info = report.planeRails[plane];
    lines.push(`[Plane: ${plane.toUpperCase()}]`);
    lines.push(`  Meko: ${info.meko}`);
    lines.push(`  ThumbGate Rails: ${info.rails.join(', ')}`);
    lines.push(`  Enforcement Rule: ${info.when}`);
    lines.push('');
  }

  if (report.audit) {
    lines.push('--- Audit Findings ---');
    lines.push(`Status: ${report.audit.pass ? 'PASS (Honest)' : 'FAIL (Violations Detected)'}`);
    if (report.audit.findings.length > 0) {
      for (const f of report.audit.findings) {
        lines.push(`  [FAIL] ${f.code}: ${f.reason}`);
      }
    } else {
      lines.push('  No fail-closed violations detected.');
    }
  }

  return lines.join('\n');
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const mapOnly = args.includes('--map-only');
  const traceArg = args.find((a) => a.startsWith('--trace='));
  const tracePath = traceArg ? traceArg.split('=')[1] : null;

  const report = buildMekoDatapackReport({
    trace: mapOnly ? null : tracePath,
  });

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatMekoDatapackReport(report));
  }

  if (report.audit && !report.audit.pass) {
    process.exit(1);
  }
  process.exit(0);
}

module.exports = {
  SOURCE_URL,
  PLANES,
  PLANE_RAILS,
  CLONE_TRIGGERS,
  hashArtifact,
  createDatapackDescriptor,
  evaluateMemoryPromotion,
  detectCloneAttempt,
  auditTrace,
  buildMekoDatapackReport,
  formatMekoDatapackReport,
};
