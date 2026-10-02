#!/usr/bin/env node
'use strict';

/**
 * Mintlify 2026 State of Knowledge FORMAT steal — not a product clone.
 *
 * Source: https://www.mintlify.com/state-of-knowledge
 *
 * Industry Context & Benchmark Data (Mintlify 2026 Report):
 *   - 66% of developer doc traffic is now AI agents (analyzed across 15k sites).
 *   - 3x increase in Model Context Protocol (MCP) tool calls.
 *   - 61% of agent-drafted pull requests are merged.
 *   - Over 80% of company knowledge lives outside documentation (tickets, forums, Notion, Slack).
 *   - Companies have no clear owner for making non-docs knowledge AI-ready.
 *   - Sarah Deaton (Anthropic): "The same page that misled one developer now misleads
 *     an unknowable number of agents, which then propagate that misunderstanding to downstream users."
 *   - Chris Riley (HubSpot): "What's good for the humans is good for the agents, but you can't
 *     treat them the same way, and treating non-human traffic as something to filter out means
 *     you're now filtering out your customers."
 *   - David Hou (Decagon): "Building the knowledge layer takes more than technical infrastructure.
 *     It takes people and operating infrastructure too—the whole organization has to buy in,
 *     or a real source of truth never happens."
 *
 * Transfers (Process only):
 *   1. Knowledge-as-Operational-Infrastructure:
 *      Treat all knowledge surfaces (docs, help center, support tickets, community forums, API specs)
 *      as active operational infrastructure rather than passive text.
 *   2. Pre-Ingestion Freshness & Poison Diode:
 *      Before an agent ingests or executes on documentation/knowledge, ThumbGate evaluates:
 *        a) Stale knowledge detection (age > TTL, missing changelog or version pinning).
 *        b) Poison pattern detection (deprecated API methods, obsolete flags, unsafe snippets, conflicting advice).
 *        c) Non-docs unverified diode (forum/ticket snippets require human review before mutating ops).
 *   3. AI-Readiness Scoring:
 *      Quantifies structure, machine-readable schemas, metadata completeness, and freshness.
 *
 * Maps onto existing ThumbGate rails:
 *   - PreToolUse diode: Interdicts read/web_fetch/MCP when ingesting poisoned or stale knowledge.
 *   - Retrieval funnel: Bounds candidate retrieval to verified, fresh knowledge surfaces.
 *   - Gate template: gate-mintlify-knowledge-poison-prevention.
 *   - Verification evidence: Cryptographic attestation of validated knowledge sources.
 *
 * Fail-Closed Honesty Constraints:
 *   - mintlify_clone_refused: Never vendor Mintlify SaaS, build a hosted doc generator, or clone Mintlify UI.
 *   - fake_metrics_refused: Never claim Mintlify's 15k sites or 66% readership as ThumbGate telemetry.
 *   - stale_knowledge_blocked: Stale knowledge (>90d without verification) cannot bypass the diode.
 *   - unverified_forum_snippet_gated: Community forum or ticket advice without schema validation is review-gated.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPORT_SOURCE_URL = 'https://www.mintlify.com/state-of-knowledge';

const MINTLIFY_BENCHMARKS = Object.freeze({
  agentReadershipPercentage: 66,
  mcpToolCallMultiplier: 3.0,
  agentPrMergeRatePercentage: 61,
  sitesAnalyzed: 15000,
  nonDocsKnowledgeSurfaces: ['help_center', 'support_tickets', 'community_forum', 'slack_notion', 'api_specs'],
});

const POISON_PATTERNS = Object.freeze([
  {
    id: 'deprecated_api_call',
    regex: /(?:explicitly\s+deprecated|deprecated\s+method|sunset\s+endpoint|obsolete\s+api\s+syntax|legacy\s+endpoint)\b/i,
    severity: 'high',
    description: 'Reference to explicitly deprecated or sunset API patterns that mislead agent tool calls.',
  },
  {
    id: 'unsafe_exec_snippet',
    regex: /(?:curl\s+-[a-zA-Z0-9_-]+\s+https?:\/\/[^\n\s|]+\s*\|\s*(?:ba)?sh|chmod\s+777\s+\/|(?:^|[`$;|&\n])\s*rm\s+-[rfRF]{2,}\s+(?:--no-preserve-root\s+)?(?:\/|~)(?:[\s;`"']|$))/i,
    severity: 'critical',
    description: 'Dangerous shell execution or unsafe permission snippet in unverified knowledge.',
  },
  {
    id: 'plaintext_credential_sample',
    regex: /(?:(?:api[_-]?key|secret[_-]?token)\s*[:=]\s*["'][a-zA-Z0-9_\-]{20,}["']|bearer\s+[a-zA-Z0-9_\-\.]{25,}|ghp_[a-zA-Z0-9]{30,}|sk-[a-zA-Z0-9]{32,})/i,
    severity: 'critical',
    description: 'Unredacted or realistic credential sample that risks agent credential stuffing or leakage.',
  },
  {
    id: 'unverified_community_advice',
    regex: /(?:just\s+ignore\s+(?:the\s+)?error|bypass\s+(?:branch\s+protection|ruleset)|--force\s+origin\s+main)/i,
    severity: 'high',
    description: 'Workaround advice advising agents to bypass protections or ignore system errors.',
  },
]);

const KNOWLEDGE_SURFACES = Object.freeze({
  docs: {
    name: 'Official Documentation',
    ttlDays: 90,
    trustTier: 'canonical',
    requiresSchema: true,
  },
  api_specs: {
    name: 'OpenAPI / Machine Schema',
    ttlDays: 60,
    trustTier: 'canonical',
    requiresSchema: true,
  },
  help_center: {
    name: 'Help Center / Knowledgebase',
    ttlDays: 90,
    trustTier: 'curated',
    requiresSchema: false,
  },
  support_tickets: {
    name: 'Support Ticket Archive',
    ttlDays: 30,
    trustTier: 'ephemeral',
    requiresSchema: false,
  },
  community_forum: {
    name: 'Community Forum / Discussions',
    ttlDays: 30,
    trustTier: 'untrusted_community',
    requiresSchema: false,
  },
  slack_notion: {
    name: 'Internal Chat / Unstructured Notes',
    ttlDays: 45,
    trustTier: 'unstructured_internal',
    requiresSchema: false,
  },
});

const FORMAT_MAPPING = Object.freeze([
  {
    mintlifyInsight: 'Agents now represent 66% of readership and move to writing 61% of merged PRs',
    thumbgateRail: 'Dual-persona diode: Treat agent traffic as high-intent consumers; apply PreToolUse checks before PR commit',
  },
  {
    mintlifyInsight: '3x increase in MCP tool calls reaching into uncurated knowledge surfaces',
    thumbgateRail: 'MCP schema diode: Interdict untrusted MCP tool inputs and enforce bounded retrieval funnel (<=50 candidates)',
  },
  {
    mintlifyInsight: 'Anthropic warning: Misleading docs mislead an unknowable number of agents propagating errors downstream',
    thumbgateRail: 'Knowledge poison prevention: Scan ingested docs for deprecated APIs, unsafe snippets, and stale dates before agent acting',
  },
  {
    mintlifyInsight: 'Over 80% of knowledge is outside docs (tickets, forums) with no AI-readiness owner',
    thumbgateRail: 'Knowledge surface federation: Classify tickets/forums into ephemeral tiers requiring human review before mutating ops',
  },
  {
    mintlifyInsight: 'Companies must treat knowledge as operational infrastructure, not static text',
    thumbgateRail: 'Durable lesson store + cryptographic action receipts: Knowledge is stateful, verifiable, and enforces prevention rules',
  },
]);

function evaluateKnowledgeFreshness(metadata = {}, options = {}) {
  const ttlDays = options.ttlDays || 90;
  const now = options.now ? new Date(options.now) : new Date();

  let updatedAt = null;
  if (metadata.lastUpdated) {
    updatedAt = new Date(metadata.lastUpdated);
  } else if (metadata.updatedAt) {
    updatedAt = new Date(metadata.updatedAt);
  } else if (metadata.date) {
    updatedAt = new Date(metadata.date);
  }

  if (!updatedAt || isNaN(updatedAt.getTime())) {
    return {
      isFresh: false,
      ageDays: null,
      reason: 'Missing or invalid lastUpdated timestamp in knowledge metadata',
      status: 'stale_unversioned',
    };
  }

  const ageMs = Math.max(0, now.getTime() - updatedAt.getTime());
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
  const isFresh = ageDays <= ttlDays;

  return {
    isFresh,
    ageDays,
    ttlDays,
    reason: isFresh
      ? `Knowledge is fresh (${ageDays}d old, TTL: ${ttlDays}d)`
      : `Knowledge is stale (${ageDays}d old exceeds TTL: ${ttlDays}d)`,
    status: isFresh ? 'fresh' : 'stale_expired',
  };
}

function scanForKnowledgePoison(content = '') {
  if (typeof content !== 'string') {
    return { hasPoison: false, detections: [] };
  }

  const detections = [];
  for (const pattern of POISON_PATTERNS) {
    const match = content.match(pattern.regex);
    if (match) {
      detections.push({
        id: pattern.id,
        severity: pattern.severity,
        description: pattern.description,
        snippet: match[0],
        index: match.index,
      });
    }
  }

  return {
    hasPoison: detections.length > 0,
    detections,
  };
}

function calculateAiReadinessScore({ freshness, poisonScan, metadata = {}, content = '', surfaceType = 'docs' }) {
  let score = 0;

  // 1. Freshness component (25 pts)
  if (freshness.isFresh) {
    score += 25;
  } else if (freshness.ageDays !== null && freshness.ageDays <= (freshness.ttlDays * 1.5)) {
    score += 10;
  }

  // 2. Poison-free component (25 pts)
  if (!poisonScan.hasPoison) {
    score += 25;
  } else {
    const hasCritical = poisonScan.detections.some(d => d.severity === 'critical');
    if (!hasCritical) score += 10;
  }

  // 3. Metadata & structure component (25 pts)
  const hasTitle = Boolean(metadata.title || metadata.name);
  const hasDescription = Boolean(metadata.description || metadata.summary);
  const hasOwner = Boolean(metadata.owner || metadata.author || metadata.maintainer);
  if (hasTitle) score += 10;
  if (hasDescription) score += 10;
  if (hasOwner) score += 5;

  // 4. Surface validity & machine readability (25 pts)
  const isMachineSurface = surfaceType === 'api_specs' || surfaceType === 'docs';
  const hasCodeBlocks = /```[a-z0-9_\-]*\n[\s\S]*?```/i.test(content);
  if (isMachineSurface) score += 15;
  if (hasCodeBlocks) score += 10;

  return Math.min(100, Math.max(0, score));
}

function evaluateKnowledgeSource({ surfaceType = 'docs', content = '', metadata = {}, options = {} }) {
  const surfaceConfig = KNOWLEDGE_SURFACES[surfaceType] || KNOWLEDGE_SURFACES.docs;
  const ttlDays = options.ttlDays || surfaceConfig.ttlDays;
  const freshness = evaluateKnowledgeFreshness(metadata, { ...options, ttlDays });
  const poisonScan = scanForKnowledgePoison(content);
  const readinessScore = calculateAiReadinessScore({ freshness, poisonScan, metadata, content, surfaceType });

  let action = 'pass';
  const reasons = [];

  // Critical poison immediately blocks
  const criticalPoison = poisonScan.detections.find(d => d.severity === 'critical');
  if (criticalPoison) {
    action = 'block';
    reasons.push(`Critical knowledge poison detected: ${criticalPoison.id} (${criticalPoison.description})`);
  }

  // Untrusted community forum advice and support tickets require review before mutating ops
  if (surfaceConfig.trustTier === 'untrusted_community' || surfaceType === 'support_tickets') {
    if (action !== 'block') action = 'review';
    reasons.push(`${surfaceType === 'support_tickets' ? 'Support ticket' : 'Community forum'} source is unverified; requires human confirmation before execution`);
  }

  // Stale canonical docs require review to prevent propagating outdated API knowledge
  if (!freshness.isFresh && surfaceConfig.trustTier === 'canonical') {
    if (action !== 'block') action = 'review';
    reasons.push(`Canonical documentation is stale (${freshness.reason}); verify before relying on obsolete APIs`);
  }

  // High-severity poison triggers review
  const highPoison = poisonScan.detections.find(d => d.severity === 'high');
  if (highPoison && action === 'pass') {
    action = 'review';
    reasons.push(`Knowledge poison warning: ${highPoison.id} (${highPoison.description})`);
  }

  if (reasons.length === 0) {
    reasons.push(`Knowledge surface approved (trustTier: ${surfaceConfig.trustTier}, readiness: ${readinessScore}%)`);
  }

  return {
    allowed: action === 'pass',
    action,
    surfaceType,
    trustTier: surfaceConfig.trustTier,
    readinessScore,
    freshness,
    poisonScan,
    reasons,
    timestamp: new Date().toISOString(),
  };
}

function runMintlifyKnowledgeAudit(targetDir, options = {}) {
  const results = [];
  const resolvedDir = path.resolve(targetDir || process.cwd());

  if (!fs.existsSync(resolvedDir)) {
    return {
      success: false,
      error: `Target path does not exist: ${resolvedDir}`,
      results: [],
    };
  }

  function walk(current) {
    const resolvedCurrent = path.resolve(current);
    if (!resolvedCurrent.startsWith(resolvedDir)) {
      return;
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      return;
    }
    if (stat.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'build', '.coverage'].includes(path.basename(current))) {
        return;
      }
      const entries = fs.readdirSync(current);
      for (const entry of entries) {
        walk(path.join(current, entry));
      }
    } else if (stat.isFile() && /\.(md|markdown|json|yaml|yml)$/i.test(current)) {
      try {
        const content = fs.readFileSync(current, 'utf8');
        const relPath = path.relative(resolvedDir, current);
        
        let surfaceType = 'docs';
        if (relPath.includes('api') || relPath.endsWith('.json') || relPath.endsWith('.yaml')) surfaceType = 'api_specs';
        if (relPath.includes('ticket') || relPath.includes('support')) surfaceType = 'support_tickets';
        if (relPath.includes('forum') || relPath.includes('community')) surfaceType = 'community_forum';

        let lastUpdated = null;
        const frontMatterMatch = content.match(/^(?:---|\+\+\+)\r?\n([\s\S]*?)\r?\n(?:---|\+\+\+)/);
        if (frontMatterMatch) {
          const dateMatch = frontMatterMatch[1].match(/(?:lastUpdated|date|updatedAt|last_updated)\s*:\s*["']?([^\r\n"']+)["']?/i);
          if (dateMatch) {
            const parsedDate = new Date(dateMatch[1].trim());
            if (!Number.isNaN(parsedDate.getTime())) {
              lastUpdated = parsedDate.toISOString();
            }
          }
        }
        if (!lastUpdated) {
          try {
            const gitOut = spawnSync('git', ['log', '-1', '--format=%cI', '--', current], { encoding: 'utf8' });
            if (gitOut.status === 0 && gitOut.stdout && gitOut.stdout.trim()) {
              const gitDate = new Date(gitOut.stdout.trim());
              if (!Number.isNaN(gitDate.getTime())) {
                lastUpdated = gitDate.toISOString();
              }
            }
          } catch {
            // git unavailable or unversioned
          }
        }

        const metadata = {
          title: path.basename(current),
          lastUpdated,
        };

        const evalResult = evaluateKnowledgeSource({ surfaceType, content, metadata, options });
        results.push({
          file: relPath,
          ...evalResult,
        });
      } catch (readErr) {
        results.push({
          file: path.relative(resolvedDir, current),
          allowed: false,
          action: 'block',
          readinessScore: 0,
          reasons: [`Unreadable knowledge source: ${readErr.message}`],
        });
      }
    }
  }

  walk(resolvedDir);

  const blockedCount = results.filter(r => r.action === 'block').length;
  const reviewCount = results.filter(r => r.action === 'review').length;
  const passedCount = results.filter(r => r.action === 'pass').length;
  const avgReadiness = results.length > 0
    ? Math.round(results.reduce((acc, r) => acc + r.readinessScore, 0) / results.length)
    : 100;

  return {
    success: blockedCount === 0 && (options.strict ? reviewCount === 0 : true),
    totalScanned: results.length,
    passedCount,
    reviewCount,
    blockedCount,
    avgReadinessScore: avgReadiness,
    benchmarks: MINTLIFY_BENCHMARKS,
    results,
  };
}

function buildMintlifyKnowledgeReport(options = {}) {
  if (options['map-only'] || options.mapOnly) {
    return {
      status: 'pass',
      mode: 'map_only',
      source: REPORT_SOURCE_URL,
      benchmarkData: MINTLIFY_BENCHMARKS,
      mapping: FORMAT_MAPPING,
      rails: [
        'scripts/mintlify-knowledge-honesty.js',
        'config/gate-templates.json (gate-mintlify-knowledge-poison-prevention)',
        'docs/agents/mintlify-knowledge-honesty.md',
        'skills/mintlify-knowledge-honesty-not-clone/SKILL.md',
      ],
      failClosedConstraints: [
        'mintlify_clone_refused',
        'fake_metrics_refused',
        'stale_knowledge_blocked',
        'unverified_forum_snippet_gated',
      ],
    };
  }

  const checkDir = options['check-dir'] || options.checkDir || path.resolve(process.cwd(), 'docs');
  const strict = Boolean(options.strict);
  const audit = runMintlifyKnowledgeAudit(checkDir, { strict });
  return {
    status: audit.success ? 'pass' : 'fail',
    mode: 'audit',
    ...audit,
  };
}

function formatMintlifyKnowledgeReport(report) {
  if (report.mode === 'map_only') {
    const lines = [
      '=== Mintlify State of Knowledge FORMAT Mapping (Process Only) ===',
      `Source: ${report.source}`,
      '',
    ];
    for (const item of report.mapping) {
      lines.push(`• Insight: ${item.mintlifyInsight}`);
      lines.push(`  ThumbGate Rail: ${item.thumbgateRail}\n`);
    }
    return lines.join('\n');
  }

  const lines = [
    '=== ThumbGate Knowledge Surface & Poison Prevention Doctor ===',
    `Total Surfaces: ${report.totalScanned}`,
    `Passed: ${report.passedCount} | Review: ${report.reviewCount} | Blocked: ${report.blockedCount}`,
    `Average AI-Readiness Score: ${report.avgReadinessScore}%`,
    '',
  ];
  if (report.blockedCount > 0 || report.reviewCount > 0) {
    lines.push('--- Flagged Knowledge Surfaces ---');
    for (const r of (report.results || []).filter(x => x.action !== 'pass')) {
      lines.push(`[${r.action.toUpperCase()}] ${r.file} (${r.readinessScore}%) - ${r.reasons.join('; ')}`);
    }
  } else {
    lines.push('✓ All knowledge surfaces are verified, fresh, and poison-free.');
  }
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const mapOnly = args.includes('--map-only');
  const strict = args.includes('--strict');

  if (mapOnly) {
    const payload = {
      source: REPORT_SOURCE_URL,
      benchmarkData: MINTLIFY_BENCHMARKS,
      mapping: FORMAT_MAPPING,
      rails: [
        'scripts/mintlify-knowledge-honesty.js',
        'config/gate-templates.json (gate-mintlify-knowledge-poison-prevention)',
        'docs/agents/mintlify-knowledge-honesty.md',
        'skills/mintlify-knowledge-honesty-not-clone/SKILL.md',
      ],
      failClosedConstraints: [
        'mintlify_clone_refused',
        'fake_metrics_refused',
        'stale_knowledge_blocked',
        'unverified_forum_snippet_gated',
      ],
    };
    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log('=== Mintlify State of Knowledge FORMAT Mapping (Process Only) ===');
      console.log(`Source: ${REPORT_SOURCE_URL}\n`);
      for (const item of FORMAT_MAPPING) {
        console.log(`• Insight: ${item.mintlifyInsight}`);
        console.log(`  ThumbGate Rail: ${item.thumbgateRail}\n`);
      }
    }
    process.exit(0);
  }

  const checkDirIndex = args.indexOf('--check-dir');
  let targetDir = path.resolve(process.cwd(), 'docs');
  if (checkDirIndex !== -1) {
    const rawDir = args[checkDirIndex + 1];
    if (!rawDir || rawDir.startsWith('--')) {
      console.error('Error: --check-dir requires a valid directory path argument.');
      process.exit(1);
    }
    targetDir = path.resolve(process.cwd(), rawDir);
  }

  const audit = runMintlifyKnowledgeAudit(targetDir, { strict });

  if (jsonMode) {
    console.log(JSON.stringify(audit, null, 2));
  } else {
    console.log('=== ThumbGate Knowledge Surface & Poison Prevention Doctor ===');
    console.log(`Audited Directory: ${targetDir}`);
    console.log(`Total Surfaces: ${audit.totalScanned}`);
    console.log(`Passed: ${audit.passedCount} | Review: ${audit.reviewCount} | Blocked: ${audit.blockedCount}`);
    console.log(`Average AI-Readiness Score: ${audit.avgReadinessScore}%\n`);
    
    if (audit.blockedCount > 0 || audit.reviewCount > 0) {
      console.log('--- Flagged Knowledge Surfaces ---');
      for (const r of audit.results.filter(x => x.action !== 'pass')) {
        console.log(`[${r.action.toUpperCase()}] ${r.file} (${r.readinessScore}%) - ${r.reasons.join('; ')}`);
      }
    } else {
      console.log('✓ All knowledge surfaces are verified, fresh, and poison-free.');
    }
  }

  process.exit(audit.success ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = {
  REPORT_SOURCE_URL,
  MINTLIFY_BENCHMARKS,
  POISON_PATTERNS,
  KNOWLEDGE_SURFACES,
  FORMAT_MAPPING,
  evaluateKnowledgeFreshness,
  scanForKnowledgePoison,
  calculateAiReadinessScore,
  evaluateKnowledgeSource,
  runMintlifyKnowledgeAudit,
  buildMintlifyKnowledgeReport,
  formatMintlifyKnowledgeReport,
};
