#!/usr/bin/env node
/**
 * Status Dashboard
 *
 * CLI dashboard that reads feedback data and outputs a learning curve summary.
 *
 * Usage:
 *   node scripts/status-dashboard.js
 *
 * Exports:
 *   generateStatus(feedbackDir) — returns status object with approval rates,
 *   trends, failure domains, memory count, prevention rule count, and learning curve.
 */

const fs = require('fs');
const path = require('path');
const { getFeedbackPaths, readJSONL } = require('./feedback-loop');

function generateStatus(feedbackDir) {
  const feedbackLogPath = path.join(feedbackDir, 'feedback-log.jsonl');
  const memoryLogPath = path.join(feedbackDir, 'memory-log.jsonl');
  const preventionRulesPath = path.join(feedbackDir, 'prevention-rules.md');

  const entries = readJSONL(feedbackLogPath);
  const totalSignals = entries.length;
  const positive = entries.filter((e) => e.signal === 'positive').length;
  const negative = entries.filter((e) => e.signal === 'negative').length;
  const approvalRate = totalSignals > 0 ? Math.round((positive / totalSignals) * 100) : 0;

  // Recent approval rate (last 20)
  const recentWindow = 20;
  const recent = entries.slice(-recentWindow);
  const recentPositive = recent.filter((e) => e.signal === 'positive').length;
  const recentApprovalRate = recent.length > 0 ? Math.round((recentPositive / recent.length) * 100) : 0;

  // Trend
  let trend = 'stable';
  if (totalSignals >= recentWindow) {
    const diff = recentApprovalRate - approvalRate;
    if (diff > 5) trend = 'improving';
    else if (diff < -5) trend = 'declining';
  }

  // Top failure domains
  const domainCounts = {};
  entries
    .filter((e) => e.signal === 'negative')
    .forEach((e) => {
      const domain = (e.richContext && e.richContext.domain) || inferDomainFromTags(e.tags);
      domainCounts[domain] = (domainCounts[domain] || 0) + 1;
    });
  const topFailureDomains = Object.entries(domainCounts)
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count);

  // Memory count
  const memoryEntries = readJSONL(memoryLogPath);
  const memoryCount = memoryEntries.length;

  // Prevention rule count
  let preventionRuleCount = 0;
  if (fs.existsSync(preventionRulesPath)) {
    const rulesContent = fs.readFileSync(preventionRulesPath, 'utf-8');
    const ruleHeaders = rulesContent.match(/^## /gm);
    preventionRuleCount = ruleHeaders ? ruleHeaders.length : 0;
  }

  // Learning curve — sliding windows of 10
  const learningCurve = [];
  const windowSize = 10;
  for (let i = 0; i + windowSize <= entries.length; i++) {
    const window = entries.slice(i, i + windowSize);
    const windowPositive = window.filter((e) => e.signal === 'positive').length;
    const windowRate = Math.round((windowPositive / windowSize) * 100);
    learningCurve.push({ window: i, approvalRate: windowRate });
  }

  return {
    totalSignals,
    positive,
    negative,
    approvalRate,
    recentApprovalRate,
    trend,
    topFailureDomains,
    memoryCount,
    preventionRuleCount,
    learningCurve,
  };
}

function inferDomainFromTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return 'general';
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  if (tagSet.has('testing') || tagSet.has('test')) return 'testing';
  if (tagSet.has('security')) return 'security';
  if (tagSet.has('performance') || tagSet.has('perf')) return 'performance';
  if (tagSet.has('ui') || tagSet.has('component')) return 'ui-components';
  if (tagSet.has('api') || tagSet.has('endpoint')) return 'api-integration';
  if (tagSet.has('git') || tagSet.has('commit')) return 'git-workflow';
  if (tagSet.has('doc') || tagSet.has('readme')) return 'documentation';
  if (tagSet.has('debug') || tagSet.has('debugging')) return 'debugging';
  if (tagSet.has('arch') || tagSet.has('architecture')) return 'architecture';
  if (tagSet.has('data') || tagSet.has('schema')) return 'data-modeling';
  return 'general';
}

function printDashboard(status) {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║        RLHF Learning Status Dashboard    ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Total Signals:     ${String(status.totalSignals).padStart(6)}              ║`);
  console.log(`║  Positive:          ${String(status.positive).padStart(6)}              ║`);
  console.log(`║  Negative:          ${String(status.negative).padStart(6)}              ║`);
  console.log(`║  Approval Rate:     ${String(status.approvalRate + '%').padStart(6)}              ║`);
  console.log(`║  Recent (last 20):  ${String(status.recentApprovalRate + '%').padStart(6)}              ║`);
  console.log(`║  Trend:             ${status.trend.padStart(6)}              ║`);
  console.log(`║  Memories:          ${String(status.memoryCount).padStart(6)}              ║`);
  console.log(`║  Prevention Rules:  ${String(status.preventionRuleCount).padStart(6)}              ║`);
  console.log('╠══════════════════════════════════════════╣');

  if (status.topFailureDomains.length > 0) {
    console.log('║  Top Failure Domains:                    ║');
    status.topFailureDomains.slice(0, 5).forEach((d) => {
      const line = `    ${d.domain}: ${d.count}`;
      console.log(`║  ${line.padEnd(38)}║`);
    });
  } else {
    console.log('║  No failure domains recorded             ║');
  }

  console.log('╠══════════════════════════════════════════╣');
  console.log('║  Learning Curve:                         ║');
  if (status.learningCurve.length > 0) {
    const step = Math.max(1, Math.floor(status.learningCurve.length / 5));
    for (let i = 0; i < status.learningCurve.length; i += step) {
      const point = status.learningCurve[i];
      const bar = '█'.repeat(Math.floor(point.approvalRate / 5));
      const line = `    w${String(point.window).padStart(3)}: ${bar} ${point.approvalRate}%`;
      console.log(`║  ${line.padEnd(38)}║`);
    }
  } else {
    console.log('║  Not enough data for learning curve      ║');
  }

  console.log('╚══════════════════════════════════════════╝');
}

if (require.main === module) {
  const { FEEDBACK_DIR } = getFeedbackPaths();
  const status = generateStatus(FEEDBACK_DIR);
  printDashboard(status);
}

module.exports = { generateStatus, printDashboard };
