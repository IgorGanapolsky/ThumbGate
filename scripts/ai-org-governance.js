#!/usr/bin/env node
'use strict';

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeBudget(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function buildAiOrgGovernancePlan(input = {}) {
  const mission = normalizeText(input.mission) || 'Continuously improve agent-governed workflows while staying within budget.';
  const monthlyBudgetUsd = normalizeBudget(input.monthlyBudgetUsd, 25);
  const roles = [
    {
      id: 'ceo',
      title: 'Planner',
      mission: 'Break goals into tickets, assign owners, and enforce ROI.',
      monthlyBudgetUsd: normalizeBudget(input.ceoBudgetUsd, Math.min(10, monthlyBudgetUsd)),
      canCreateAgents: false,
    },
    {
      id: 'research_analyst',
      title: 'Research Analyst',
      mission: 'Collect market and technical signals into structured briefs.',
      monthlyBudgetUsd: normalizeBudget(input.researchBudgetUsd, Math.min(5, monthlyBudgetUsd)),
      canCreateAgents: false,
    },
    {
      id: 'qa_operator',
      title: 'QA Operator',
      mission: 'Review evidence, tests, diffs, and spend anomalies before promotion.',
      monthlyBudgetUsd: normalizeBudget(input.qaBudgetUsd, Math.min(5, monthlyBudgetUsd)),
      canCreateAgents: false,
    },
  ];

  return {
    generatedAt: normalizeText(input.generatedAt) || new Date().toISOString(),
    orgName: normalizeText(input.orgName) || 'ThumbGate Agent Company',
    mission,
    monthlyBudgetUsd,
    roles,
    ticketTemplates: [
      {
        id: 'market_signal_brief',
        ownerRole: 'research_analyst',
        outputSchema: ['source', 'claim', 'relevance', 'action', 'evidence'],
      },
      {
        id: 'workflow_hardening',
        ownerRole: 'ceo',
        outputSchema: ['risk', 'gate', 'test', 'rollback', 'owner'],
      },
      {
        id: 'evidence_review',
        ownerRole: 'qa_operator',
        outputSchema: ['claim', 'evidence', 'verdict', 'missing_proof'],
      },
    ],
    approvalGates: [
      'new_agent_role',
      'budget_increase',
      'credentialed_connector_write',
      'production_release',
      'public_claim_without_evidence',
    ],
    audit: {
      daily: ['ticket outcomes', 'spend by role', 'blocked actions', 'open approvals'],
      weekly: ['low ROI tickets', 'stale agents', 'budget cap changes', 'policy drift'],
    },
  };
}

function evaluateAiOrgAction(action = {}, plan = buildAiOrgGovernancePlan()) {
  const type = normalizeText(action.type);
  const issues = [];
  if (type === 'create_agent') issues.push('new_agent_role');
  if (type === 'raise_budget') issues.push('budget_increase');
  if (type === 'connector_write') issues.push('credentialed_connector_write');
  if (type === 'public_claim' && !(Array.isArray(action.evidence) && action.evidence.length > 0)) {
    issues.push('public_claim_without_evidence');
  }
  const gateHits = issues.filter((issue) => plan.approvalGates.includes(issue));
  return {
    decision: gateHits.length > 0 ? 'warn' : 'allow',
    gateHits,
    requiredApproval: gateHits.length > 0,
  };
}

module.exports = {
  buildAiOrgGovernancePlan,
  evaluateAiOrgAction,
};
