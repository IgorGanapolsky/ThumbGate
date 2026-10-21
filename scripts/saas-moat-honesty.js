#!/usr/bin/env node
'use strict';

/**
 * saas-moat-honesty.js — 2026 SaaS Moat & Seat-Compression Diagnostic (Walling FORMAT)
 *
 * Source:
 *   Rob Walling, "The Only SaaS Moats Left in 2026"
 *   https://www.youtube.com/watch?v=KpILHX2D-AA
 *
 * Transfers onto existing ThumbGate rails:
 *   1. 8-Moat Self-Assessment (0-100 scale): Agency, Operational Grit, System of Record,
 *      Reliance, Learning Loop, Network Effect, Trust & Ecosystem, Regulatory.
 *   2. Seat-Compression & Entitlement Boundary Audit: proves Ed25519 signed entitlements
 *      gate the 5 learned models and 3 exporters, and blocks forged `tg_pro_...` prefix
 *      keys under THUMBGATE_ENFORCE_ENTITLEMENTS=1.
 *   3. Cross-Customer Learning Loop (Moat #7): distills blocked tool calls and negative
 *      feedback into secret-redacted, path-normalized, SHA-256 structural rule signatures
 *      so cross-customer intelligence stays in the control plane even when a customer
 *      exports raw DPO pairs (export-dpo-pairs.js). Refuses raw transcript exfiltration.
 *
 * Compare-not-clone:
 *   - Does not claim private Core code is the moat (MOAT.md: 212/216 scripts ship publicly).
 *   - Does not fabricate SOC2/ISO certifications or fake partner ecosystems.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { redactSecretsDeep, containsSecret } = require('./secret-redaction');
const { verifyLicense: verifySignedEntitlement, TIER_FEATURES } = require('./entitlement');
const { verifyLicense: verifyRuntimeLicense, isValidKey } = require('./license');

const SOURCE_URL = 'https://www.youtube.com/watch?v=KpILHX2D-AA';
const GATE_ID = 'saas-moat-seat-compression-honesty';

const CROWN_JEWEL_MODELS = Object.freeze([
  'scripts/risk-scorer.js',
  'scripts/bayes-optimal-gate.js',
  'scripts/thompson-sampling.js',
  'scripts/agent-reward-model.js',
  'scripts/intervention-policy.js',
]);

const CROWN_JEWEL_EXPORTERS = Object.freeze([
  'scripts/export-dpo-pairs.js',
  'scripts/export-hf-dataset.js',
  'scripts/export-databricks-bundle.js',
]);

const RAIL_MAP = Object.freeze([
  {
    wallingMoat: '3. Agency (Reporting -> Permission to Act)',
    score: 75,
    thumbgateRail: 'scripts/gates-engine.js (PreToolUse DENY/ALLOW <5ms p95) + reconcile_purchase_ledger',
  },
  {
    wallingMoat: '8. Operational Grit (Painful Infrastructure)',
    score: 65,
    thumbgateRail: 'Multi-CLI hook/adapter matrix (Claude Code, Cursor, Codex, Gemini, Amp, Cline, OpenCode) + $499 Diagnostic',
  },
  {
    wallingMoat: '2. System of Record (Point Solution -> Audit OS)',
    score: 45,
    thumbgateRail: 'Append-only task outcomes (record_task_outcome), session leases, and tamper-evident financial ledger',
  },
  {
    wallingMoat: '4. Reliance (Calculation -> Unchecked Infrastructure)',
    score: 40,
    thumbgateRail: 'config/performance-budgets.json (<3ms compiled guard eval) + zero-bypass config/main-branch-ruleset.json',
  },
  {
    wallingMoat: '7. Learning Loop (Data Collector -> Cross-Customer Intelligence)',
    score: 55,
    thumbgateRail: 'Ed25519-gated learned models (scripts/entitlement.js + scripts/license.js) + anonymized structural signature loop',
  },
  {
    wallingMoat: '6. Network Effect (Single-Seat -> Multi-Party Coordination)',
    score: 35,
    thumbgateRail: 'scripts/session-lease.js + mcp__agent_mesh_* + list_human_escalations (multi-agent + human approval)',
  },
  {
    wallingMoat: '1. Trust & Ecosystem (Vertical -> Partner Channel)',
    score: 10,
    thumbgateRail: '$499 Managed Workflow Diagnostic (founder-delivered today; partner intake at public/partner-intake.html)',
  },
  {
    wallingMoat: '5. Regulatory (Held Certifications)',
    score: 5,
    thumbgateRail: 'Enforces OWASP/SBOM gates (scripts/salt-code-policy-honesty.js); 0 claimed external accreditations',
  },
]);

const FAKE_MOAT_CLAIMS_RE = /\b(?:closed-source core is our moat|private core holds 100% of intelligence|soc\s*2\s+type\s+ii\s+certified|fedramp\s+authorized)\b/i;
const SEAT_TRAP_CLAIM_RE = /\b(?:human seat-based pricing only|charge per human support rep seat)\b/i;

function normalizeBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function finding(id, message) {
  return { id, severity: 'fail', gateId: GATE_ID, message };
}

const CLI_SECRET_ARG_RE = /(?:--(?:password|passwd|secret|token|api[-_]?key)(?:\s+|=)|\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*|\b-u\s+[^\s:]+\s*:\s*)([^\s'"]+|'[^']*'|"[^"]*")/gi;

function normalizeCommandPattern(rawCommand) {
  if (typeof rawCommand !== 'string' || !rawCommand.trim()) return '';
  const preScrubbed = rawCommand.replace(CLI_SECRET_ARG_RE, (match, secretPart) =>
    match.slice(0, match.length - secretPart.length) + '[REDACTED]'
  );
  const scrubbed = String(redactSecretsDeep(preScrubbed))
    .replace(/\/Users\/[^\s/'"]+/g, '/Users/<user>')
    .replace(/\/home\/[^\s/'"]+/g, '/home/<user>')
    .replace(/C:\\Users\\[^\s\\'"]+/gi, 'C:\\Users\\<user>')
    .replace(/\b[0-9a-f]{7,40}\b/gi, '<sha>')
    .replace(/\b\d{4,}\b/g, '<num>')
    .replace(/\s+/g, ' ')
    .trim();
  return scrubbed.slice(0, 240);
}

/**
 * Distill a single blocked tool call or negative feedback event into an
 * anonymized, secret-free structural signature suitable for cross-customer
 * rule-weight aggregation (Moat #7).
 */
function distillCrossCustomerSignature(event = {}) {
  if (!event || typeof event !== 'object') {
    return { ok: false, reason: 'invalid_event' };
  }
  if (event.includeRawTranscript === true || typeof event.rawTranscript === 'string') {
    return {
      ok: false,
      reason: 'raw_transcript_exfiltration_blocked',
    };
  }
  const toolName = String(event.toolName || event.tool_name || 'unknown').trim();
  const rawCommand = String(event.command || event.pattern || event.context || '').trim();
  if (!rawCommand) {
    return { ok: false, reason: 'empty_pattern' };
  }
  const normalizedPattern = normalizeCommandPattern(rawCommand);
  if (containsSecret(normalizedPattern)) {
    return { ok: false, reason: 'unredacted_secret_detected' };
  }
  const category = String(event.category || event.gateId || 'pretool-interdiction').trim().toLowerCase();
  const orgHash = event.orgId
    ? crypto.createHash('sha256').update(`tg-org:${String(event.orgId)}`).digest('hex').slice(0, 16)
    : 'anon_org';
  const signatureHash = crypto
    .createHash('sha256')
    .update(`${toolName.toLowerCase()}::${category}::${normalizedPattern}`)
    .digest('hex')
    .slice(0, 24);

  return {
    ok: true,
    signatureHash,
    toolName,
    category,
    normalizedPattern,
    orgHash,
  };
}

/**
 * Aggregate distilled signatures across customer orgs. Learned intelligence
 * promotes to the shared rule pack only when observed across >= 2 distinct
 * orgs and >= 3 total interdictions, ensuring raw data exports by a single
 * customer cannot strip the network's accumulated rule weights.
 */
function aggregateCrossCustomerLoop(events = []) {
  const buckets = new Map();
  const rejected = [];

  for (const evt of Array.isArray(events) ? events : []) {
    const distilled = distillCrossCustomerSignature(evt);
    if (!distilled.ok) {
      rejected.push({ reason: distilled.reason });
      continue;
    }
    const existing = buckets.get(distilled.signatureHash) || {
      signatureHash: distilled.signatureHash,
      toolName: distilled.toolName,
      category: distilled.category,
      normalizedPattern: distilled.normalizedPattern,
      occurrenceCount: 0,
      orgHashes: new Set(),
    };
    existing.occurrenceCount += 1;
    existing.orgHashes.add(distilled.orgHash);
    buckets.set(distilled.signatureHash, existing);
  }

  const signatures = [];
  for (const item of buckets.values()) {
    const uniqueOrgs = item.orgHashes.size;
    const promotedToSharedPack = uniqueOrgs >= 2 && item.occurrenceCount >= 3;
    signatures.push({
      signatureHash: item.signatureHash,
      toolName: item.toolName,
      category: item.category,
      normalizedPattern: item.normalizedPattern,
      occurrenceCount: item.occurrenceCount,
      uniqueOrgs,
      promotedToSharedPack,
    });
  }

  signatures.sort((a, b) => b.occurrenceCount - a.occurrenceCount || a.signatureHash.localeCompare(b.signatureHash));

  return {
    totalEvents: Array.isArray(events) ? events.length : 0,
    acceptedCount: (Array.isArray(events) ? events.length : 0) - rejected.length,
    rejectedCount: rejected.length,
    rejected,
    promotedCount: signatures.filter((s) => s.promotedToSharedPack).length,
    signatures,
  };
}

/**
 * Audit the repository's entitlement boundary and crown-jewel gating.
 */
function auditEntitlementBoundary(repoRoot = path.resolve(__dirname, '..')) {
  const findings = [];
  const gatedModels = [];
  const gatedExporters = [];

  const stripImports = (source) =>
    String(source || '')
      .split('\n')
      .filter((line) => !/\brequire\s*\(/.test(line))
      .join('\n');

  for (const relPath of CROWN_JEWEL_MODELS) {
    const abs = path.join(repoRoot, relPath);
    if (!fs.existsSync(abs)) {
      findings.push(finding('missing-crown-jewel-model', `Missing learned model file: ${relPath}`));
      continue;
    }
    const bodyWithoutImports = stripImports(fs.readFileSync(abs, 'utf8'));
    if (/\b(?:requireLearnedModelsEntitlement|requireEntitlement|requirePaidFeature)\s*\(/.test(bodyWithoutImports)) {
      gatedModels.push(relPath);
    } else {
      findings.push(finding('ungated-crown-jewel-model', `Learned model lacks entitlement check: ${relPath}`));
    }
  }

  for (const relPath of CROWN_JEWEL_EXPORTERS) {
    const abs = path.join(repoRoot, relPath);
    if (!fs.existsSync(abs)) {
      findings.push(finding('missing-crown-jewel-exporter', `Missing exporter file: ${relPath}`));
      continue;
    }
    const src = fs.readFileSync(abs, 'utf8');
    if (/requireEntitlement\(['"]data-export['"]\)|requirePaidFeature\(['"]data-export['"]\)/.test(src)) {
      gatedExporters.push(relPath);
    } else {
      findings.push(finding('ungated-crown-jewel-exporter', `Exporter lacks data-export entitlement check: ${relPath}`));
    }
  }

  // Verify fake prefix keys fail under THUMBGATE_ENFORCE_ENTITLEMENTS=1 in both entitlement.js and license.js
  const fakeKey = 'tg_pro_forged_prefix_bypass_attempt';
  const signedCheck = verifySignedEntitlement(fakeKey);
  const runtimeEnforcedCheck = verifyRuntimeLicense({
    env: { THUMBGATE_ENFORCE_ENTITLEMENTS: '1', THUMBGATE_PRO_KEY: fakeKey },
    homeDir: '/nonexistent-tg-home',
  });
  const validKeyEnforcedCheck = isValidKey(fakeKey, {
    env: { THUMBGATE_ENFORCE_ENTITLEMENTS: '1' },
  });

  if (signedCheck.valid || runtimeEnforcedCheck.valid || validKeyEnforcedCheck) {
    findings.push(
      finding(
        'prefix-key-bypass-under-enforcement',
        'Forged tg_pro_ prefix key passed verification when THUMBGATE_ENFORCE_ENTITLEMENTS=1'
      )
    );
  }

  return {
    ok: findings.length === 0,
    gatedModelsCount: gatedModels.length,
    expectedModelsCount: CROWN_JEWEL_MODELS.length,
    gatedExportersCount: gatedExporters.length,
    expectedExportersCount: CROWN_JEWEL_EXPORTERS.length,
    forgedPrefixRejectedWhenEnforced: !signedCheck.valid && !runtimeEnforcedCheck.valid && !validKeyEnforcedCheck,
    proTierFeatures: TIER_FEATURES.pro,
    findings,
  };
}

function buildSaasMoatHonestyReport(options = {}) {
  const repoRoot = options.repoRoot || path.resolve(__dirname, '..');
  const mapOnly = normalizeBoolean(options.mapOnly ?? options['map-only']);
  const findings = [];

  if (typeof options.claim === 'string' && options.claim.trim()) {
    const claim = options.claim.trim();
    if (FAKE_MOAT_CLAIMS_RE.test(claim)) {
      findings.push(
        finding(
          'dishonest-moat-claim',
          `Claim violates MOAT.md / regulatory truth: "${claim}"`
        )
      );
    }
    if (SEAT_TRAP_CLAIM_RE.test(claim)) {
      findings.push(
        finding(
          'seat-compression-trap',
          `Claim anchors on human-seat pricing instead of governed agent workflow boundaries: "${claim}"`
        )
      );
    }
  }

  const entitlementAudit = mapOnly ? null : auditEntitlementBoundary(repoRoot);
  if (entitlementAudit && !entitlementAudit.ok) {
    findings.push(...entitlementAudit.findings);
  }

  let loopSummary = null;
  if (Array.isArray(options.events)) {
    loopSummary = aggregateCrossCustomerLoop(options.events);
    if (loopSummary.rejectedCount > 0) {
      for (const r of loopSummary.rejected) {
        findings.push(finding(`cross-customer-loop-${r.reason}`, `Rejected cross-customer event: ${r.reason}`));
      }
    }
  }

  const compositeScore = Math.round(
    RAIL_MAP.reduce((acc, item) => acc + item.score, 0) / RAIL_MAP.length
  );

  return {
    ok: findings.length === 0,
    status: findings.length === 0 ? 'ready' : 'fail',
    sourceUrl: SOURCE_URL,
    gateId: GATE_ID,
    compositeMoatScore: compositeScore,
    topMoats: ['3. Agency (Permission to Act)', '8. Operational Grit', '7. Learning Loop'],
    railMap: RAIL_MAP,
    ...(entitlementAudit ? { entitlementAudit } : {}),
    ...(loopSummary ? { crossCustomerLoop: loopSummary } : {}),
    findings,
  };
}

function formatSaasMoatHonestyReport(report) {
  const lines = [
    `SaaS Moat & Seat-Compression Honesty (${report.status.toUpperCase()})`,
    `Source: ${report.sourceUrl}`,
    `Composite 8-Moat Score: ${report.compositeMoatScore}/100`,
    `Primary Defensible Moats: ${report.topMoats.join(' | ')}`,
    '',
    '8-Moat Assessment:',
  ];
  for (const row of report.railMap) {
    lines.push(`  - [${String(row.score).padStart(2, ' ')}/100] ${row.wallingMoat} -> ${row.thumbgateRail}`);
  }
  if (report.entitlementAudit) {
    lines.push('');
    lines.push(
      `Entitlement Boundary: models=${report.entitlementAudit.gatedModelsCount}/${report.entitlementAudit.expectedModelsCount}, `
      + `exporters=${report.entitlementAudit.gatedExportersCount}/${report.entitlementAudit.expectedExportersCount}, `
      + `forgedPrefixRejected=${report.entitlementAudit.forgedPrefixRejectedWhenEnforced}`
    );
  }
  if (report.findings.length > 0) {
    lines.push('');
    lines.push('Findings:');
    for (const item of report.findings) {
      lines.push(`  - [${item.id}] ${item.message}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [k, ...rest] = arg.slice(2).split('=');
    args[k] = rest.length ? rest.join('=') : true;
  }
  return args;
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  let events;
  if (typeof args.events === 'string' && args.events.trim()) {
    events = JSON.parse(fs.readFileSync(path.resolve(args.events.trim()), 'utf8'));
    if (!Array.isArray(events)) {
      console.error('saas-moat-honesty: --events file must contain a JSON array of events');
      process.exitCode = 1;
      return 1;
    }
  }
  const report = buildSaasMoatHonestyReport({
    mapOnly: args['map-only'],
    claim: args.claim,
    events,
  });
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    process.stdout.write(formatSaasMoatHonestyReport(report));
  }
  if ((args.strict && report.status !== 'ready') || report.status === 'fail') {
    process.exitCode = 1;
    return 1;
  }
  return 0;
}

if (require.main === module) {
  runCli();
}

module.exports = {
  SOURCE_URL,
  GATE_ID,
  RAIL_MAP,
  CROWN_JEWEL_MODELS,
  CROWN_JEWEL_EXPORTERS,
  normalizeCommandPattern,
  distillCrossCustomerSignature,
  aggregateCrossCustomerLoop,
  auditEntitlementBoundary,
  buildSaasMoatHonestyReport,
  formatSaasMoatHonestyReport,
  runCli,
};
