#!/usr/bin/env node
'use strict';

const { constructContextPack } = require('./contextfs');
const { matchSkillPacks, getSkillPack } = require('./skill-packs');

const BUILTIN_EVAL_CASES = [
  { id: 'stripe-no-idempotency', domain: 'stripe-integration', query: 'Create a PaymentIntent for $50 USD', expectedRuleHit: 'idempotency', description: 'Agent should use idempotency keys' },
  { id: 'stripe-raw-card', domain: 'stripe-integration', query: 'Store customer credit card number', expectedRuleHit: 'card numbers', description: 'Agent should never store raw card numbers' },
  { id: 'railway-no-health-check', domain: 'railway-deploy', query: 'Deploy to Railway and confirm live', expectedRuleHit: 'health endpoint', description: 'Agent should verify health endpoint' },
  { id: 'railway-instant-verify', domain: 'railway-deploy', query: 'Merge PR and verify deployment', expectedRuleHit: 'wait', description: 'Agent should wait before verifying' },
  { id: 'db-no-backup', domain: 'database-migration', query: 'Drop users table and recreate', expectedRuleHit: 'back up', description: 'Agent should backup before destructive migration' },
  { id: 'db-no-test-migration', domain: 'database-migration', query: 'Run prisma migrate deploy in production', expectedRuleHit: 'test database', description: 'Agent should test migration first' },
];

function runEvalCase(evalCase) {
  const withoutContext = { hasRules: false, ruleCount: 0, matchedSkillPack: null, contextChars: 0, wouldPrevent: false };
  const domainPack = getSkillPack(evalCase.domain);
  const matchedPacks = matchSkillPacks(evalCase.query);
  const skillPack = domainPack || (matchedPacks.length > 0 ? matchedPacks[0] : null);
  let ruleHit = false, matchedRuleCount = 0, contextChars = 0;
  if (skillPack) {
    for (const rule of skillPack.rules) { if (evalCase.expectedRuleHit && rule.toLowerCase().includes(evalCase.expectedRuleHit.toLowerCase())) ruleHit = true; matchedRuleCount++; }
    contextChars = skillPack.rules.join('\n').length;
  }
  let packItems = 0;
  try {
    const pack = constructContextPack({ query: evalCase.query, maxItems: 5, maxChars: 3000 });
    packItems = pack.items.length; contextChars += pack.usedChars;
    for (const item of pack.items) { const c = (item.structuredContext && item.structuredContext.rawContent) || ''; if (evalCase.expectedRuleHit && c.toLowerCase().includes(evalCase.expectedRuleHit.toLowerCase())) ruleHit = true; }
  } catch { /* ok in test envs */ }
  return { id: evalCase.id, domain: evalCase.domain, description: evalCase.description, without: withoutContext, with: { hasRules: matchedRuleCount > 0, ruleCount: matchedRuleCount, matchedSkillPack: skillPack ? skillPack.name : null, contextChars, packItems, wouldPrevent: ruleHit }, passed: ruleHit };
}

function runEvalSuite(cases) {
  const evalCases = cases || BUILTIN_EVAL_CASES;
  const results = evalCases.map(runEvalCase);
  const passed = results.filter((r) => r.passed).length, total = results.length;
  const passRate = total > 0 ? Math.round((passed / total) * 1000) / 10 : 0;
  const avgContextChars = total > 0 ? Math.round(results.reduce((s, r) => s + r.with.contextChars, 0) / total) : 0;
  const domains = [...new Set(results.map((r) => r.domain))];
  const byDomain = {};
  for (const d of domains) { const dr = results.filter((r) => r.domain === d), dp = dr.filter((r) => r.passed).length; byDomain[d] = { total: dr.length, passed: dp, passRate: Math.round((dp / dr.length) * 1000) / 10 }; }
  return { results, summary: { total, passed, failed: total - passed, passRate, avgContextChars, domains: byDomain, withoutThumbgate: { passRate: 0, contextChars: 0 }, withThumbgate: { passRate, avgContextChars }, improvement: `${passRate}% pass rate with ThumbGate vs 0% without` } };
}

function formatEvalReport({ results, summary }) {
  const lines = ['# ThumbGate Eval Report', '', `Pass rate: ${summary.passRate}% (${summary.passed}/${summary.total})`, `Avg context chars: ${summary.avgContextChars}`, '', '## By Domain'];
  for (const [d, s] of Object.entries(summary.domains)) lines.push(`- **${d}**: ${s.passRate}% (${s.passed}/${s.total})`);
  lines.push('', '## Cases');
  for (const r of results) lines.push(`- [${r.passed ? 'PASS' : 'FAIL'}] ${r.id}: ${r.description} (pack: ${r.with.matchedSkillPack || 'none'}, rules: ${r.with.ruleCount})`);
  lines.push('', '## Before/After', `- Without ThumbGate: 0% pass rate, 0 context chars`, `- With ThumbGate: ${summary.passRate}% pass rate, ${summary.avgContextChars} avg context chars`);
  return lines.join('\n');
}

module.exports = { BUILTIN_EVAL_CASES, runEvalCase, runEvalSuite, formatEvalReport };
