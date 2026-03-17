#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { getAutoGatesPath } = require('./auto-promote-gates');

const DEFAULT_LOG = path.join(__dirname, '..', '.claude', 'memory', 'feedback', 'feedback-log.jsonl');
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
      const key = normalize(e.context);
      if (key.length > 10) {
        if (!contextCounts[key]) {
          contextCounts[key] = { 
            raw: e.context, 
            count: 0, 
            tool, 
            tags: e.tags || [],
            hasHighRisk: (e.tags || []).some(t => HIGH_RISK_TAGS.has(t))
          };
        }
        contextCounts[key].count++;
      }
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

if (require.main === module) {
  try {
    const logPath = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : DEFAULT_LOG;
    const entries = parseFeedbackFile(logPath);
    const report = analyze(entries);
    if (process.argv.includes('--rules')) {
      console.log(toRules(report));
    } else {
      console.log(JSON.stringify(report, null, 2));
    }
  } catch (err) {
    console.error('Warning:', err.message);
  }
  process.exit(0);
}

module.exports = { parseFeedbackFile, classifySignal, analyze, toRules, normalize };
