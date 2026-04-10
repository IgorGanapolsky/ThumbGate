#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { getAutoGatesPath } = require('./auto-promote-gates');
const { resolveFeedbackDir } = require('./feedback-paths');
const { deduplicateFeedback } = require('./semantic-dedup');

const DEFAULT_LOG = path.join(resolveFeedbackDir(), 'feedback-log.jsonl');
const NEG = new Set(['negative', 'negative_strong', 'down', 'thumbs_down']);
const POS = new Set(['positive', 'positive_strong', 'up', 'thumbs_up']);

function parseFeedbackFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const entries = [];
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { entries.push(JSON.parse(trimmed)); } catch { /* skip malformed */ }
  }
  return entries;
}

function classifySignal(entry) {
  const sig = (entry.signal || entry.feedback || '').toLowerCase();
  if (NEG.has(sig)) return 'negative';
  if (POS.has(sig)) return 'positive';
  return null;
}

function normalize(ctx) {
  return (ctx || '').replace(/\/Users\/[^\s/]+/g, '~').replace(/:[0-9]+/g, '').toLowerCase().trim();
}

const HIGH_RISK_TAGS = new Set(['git-workflow', 'scope-control', 'trust-breach', 'execution-gap', 'regression', 'security']);
function analyze(entries) {
  let positiveCount = 0, negativeCount = 0;
  const categories = {};
  const toolBuckets = {};
  const contextCounts = {};

  for (const e of entries) {
    const cls = classifySignal(e);
    if (!cls) continue;
    cls === 'positive' ? positiveCount++ : negativeCount++;

    const cat = e.task_category || e.category || 'uncategorized';
    categories[cat] = categories[cat] || { positive: 0, negative: 0, total: 0 };
    categories[cat][cls]++;
    categories[cat].total++;

    if (cls === 'negative') {
      const tool = e.tool_name || 'unknown';
      toolBuckets[tool] = (toolBuckets[tool] || 0) + 1;
    }
  }

  // Semantic dedup: cluster near-duplicate negatives into weighted "feedback tokens"
  const negEntries = entries.filter((e) => classifySignal(e) === 'negative');
  const dedupedNeg = deduplicateFeedback(negEntries);
  for (const d of dedupedNeg) {
    const key = normalize(d.context);
    if (key.length > 10 && !contextCounts[key]) {
      const tags = d._mergedTags || d.tags || [];
      contextCounts[key] = {
        raw: d.context,
        count: d._clusterCount || 1,
        tool: d.tool_name || 'unknown',
        tags,
        hasHighRisk: tags.some(t => HIGH_RISK_TAGS.has(t)),
      };
    }
  }

  const total = positiveCount + negativeCount;
  const recurringIssues = Object.values(contextCounts)
    .filter(v => v.count >= 2 || (v.count >= 1 && v.hasHighRisk)) // Lower threshold for high-risk
    .sort((a, b) => b.count - a.count)
    .map(v => {
      // Threshold hardening: promote high-risk to block after 2 failures
      const threshold = v.hasHighRisk ? 2 : 4;
      const severity = v.count >= threshold ? 'critical' : v.count >= (threshold - 1) ? 'high' : 'medium';
      
      return {
        pattern: v.raw.slice(0, 120),
        count: v.count,
        severity,
        hasHighRisk: v.hasHighRisk,
        suggestedRule: `NEVER ${v.raw.slice(0, 80).replace(/CRITICAL ERROR - User frustrated: /i, '')}`,
      };
    });

  // Auto-Gate Promotion logic
  promoteToGates(recurringIssues);

  return {
    generatedAt: new Date().toISOString(),
    totalFeedback: total,
    negativeCount,
    positiveCount,
    negativeRate: total ? `${((negativeCount / total) * 100).toFixed(1)}%` : '0%',
    recurringIssues,
    categoryBreakdown: categories,
    topTools: toolBuckets,
  };
}

function promoteToGates(recurringIssues) {
  const autoGatePath = getAutoGatesPath();
  const autoGates = { version: 1, gates: [] };
  
  for (const issue of recurringIssues) {
    if (issue.severity === 'critical') {
      // Extract key nouns/verbs for pattern matching
      const keywords = issue.pattern
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 4)
        .slice(0, 3);
      
      if (keywords.length >= 2) {
        const pattern = keywords.join('.*');
        autoGates.gates.push({
          id: `auto-${issue.hasHighRisk ? 'hardened' : 'promoted'}-${Date.now().toString(36)}`,
          pattern,
          action: 'block',
          message: `Automatically blocked due to repeated failures: ${issue.suggestedRule}`,
          severity: 'critical',
          source: 'feedback-auto-promotion'
        });
      }
    }
  }

  if (autoGates.gates.length > 0) {
    fs.mkdirSync(path.dirname(autoGatePath), { recursive: true });
    fs.writeFileSync(autoGatePath, JSON.stringify(autoGates, null, 2));
  }
}

function toRules(report) {
  const lines = ['# Suggested Rules from Feedback Analysis', `# Generated: ${report.generatedAt}`, ''];
  lines.push(`# Negative rate: ${report.negativeRate} (${report.negativeCount}/${report.totalFeedback})`);
  lines.push('');
  for (const issue of report.recurringIssues) {
    lines.push(`- [${issue.severity.toUpperCase()}] (${issue.count}x) ${issue.suggestedRule}`);
  }
  if (!report.recurringIssues.length) lines.push('- No recurring issues detected.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// LLM-Powered Rule Analysis
// ---------------------------------------------------------------------------

const LLM_RULES_SYSTEM_PROMPT = `You are a rule generation engine for ThumbGate, an AI coding agent safety system.

Given a batch of negative feedback entries from developers using AI coding agents, generate prevention rules.

Return ONLY a valid JSON array of rule objects:
[
  {
    "pattern": "<valid JavaScript regex string to match against tool call input>",
    "action": "block" or "warn",
    "message": "<human-readable explanation of why this is blocked/warned>",
    "severity": "critical", "high", or "medium",
    "reasoning": "<why this pattern was identified as problematic>"
  }
]

Guidelines:
- Pattern must be a valid JavaScript regex (will be used with new RegExp(pattern, 'i')).
- Prefer specific patterns over broad ones. "force.*push.*main" is better than "push".
- Use "block" for destructive or high-risk patterns, "warn" for patterns that need review.
- Deduplicate similar entries — one rule can cover multiple related failures.
- Return at most 10 rules, prioritized by severity.
- Do NOT include any text outside the JSON array.`;

async function analyzeWithLLM(entries) {
  const { isAvailable, callClaude, MODELS } = require('./llm-client');
  if (!isAvailable()) return null;

  const negativeEntries = entries
    .filter((e) => classifySignal(e) === 'negative')
    .filter((e) => (e.context || '').length > 20)
    .slice(0, 30);

  if (negativeEntries.length === 0) return null;

  const batch = negativeEntries.map((e, i) => {
    const ctx = (e.context || '').slice(0, 200);
    const tool = e.tool_name || 'unknown';
    const tags = (e.tags || []).join(', ');
    return `${i + 1}. [${tool}] ${ctx}${tags ? ` (tags: ${tags})` : ''}`;
  }).join('\n');

  const raw = await callClaude({
    systemPrompt: LLM_RULES_SYSTEM_PROMPT,
    userPrompt: `Analyze these ${negativeEntries.length} negative feedback entries and generate prevention rules:\n\n${batch}`,
    model: MODELS.FAST,
    maxTokens: 1024,
  });

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;

    return parsed
      .filter((r) => r.pattern && r.action && r.message && r.severity)
      .slice(0, 10)
      .map((r) => ({
        pattern: r.pattern,
        count: negativeEntries.length,
        severity: ['critical', 'high', 'medium'].includes(r.severity) ? r.severity : 'medium',
        hasHighRisk: r.severity === 'critical',
        suggestedRule: r.message,
        reasoning: r.reasoning || '',
        source: 'llm-analysis',
      }));
  } catch {
    return null;
  }
}

if (require.main === module) {
  (async () => {
    try {
      const logPath = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : DEFAULT_LOG;
      const entries = parseFeedbackFile(logPath);
      const useLLM = process.argv.includes('--llm');

      let report;
      if (useLLM) {
        const llmIssues = await analyzeWithLLM(entries);
        if (llmIssues) {
          promoteToGates(llmIssues);
          const heuristicReport = analyze(entries);
          report = { ...heuristicReport, recurringIssues: llmIssues, source: 'llm' };
        } else {
          report = analyze(entries);
          report.source = 'heuristic-fallback';
        }
      } else {
        report = analyze(entries);
      }

      if (process.argv.includes('--rules')) {
        console.log(toRules(report));
      } else {
        console.log(JSON.stringify(report, null, 2));
      }
    } catch (err) {
      console.error('Warning:', err.message);
    }
    process.exit(0);
  })();
}

module.exports = { parseFeedbackFile, classifySignal, analyze, analyzeWithLLM, promoteToGates, toRules, normalize };
