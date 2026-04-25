#!/usr/bin/env node
'use strict';

function buildEnterpriseAgentRollout(input = {}) {
  const industry = input.industry || 'enterprise software';
  return {
    program: 'ThumbGate Enterprise Agent Acceleration',
    industry,
    operatingModel: {
      forwardDeployedEngineer: true,
      humanInTheLead: true,
      domainExpertsRequired: true,
      sovereignDeploymentOption: true,
    },
    phases: [
      { id: 'discover', outcome: 'rank workflows by measurable business value and risk' },
      { id: 'prototype', outcome: 'ship one governed agent with evidence and rollback' },
      { id: 'scale', outcome: 'publish reusable agent catalog and approval policies' },
      { id: 'operate', outcome: 'review traces, ROI, incidents, and policy drift weekly' },
    ],
    governance: [
      'human oversight for high-stakes recommendations',
      'sovereign data boundary when required',
      'agent catalog with owner and allowed tools',
      'decision journal for every business-critical action',
      'measurable outcome before expansion',
    ],
    metrics: ['cycle_time_saved', 'blocked_risky_actions', 'approved_agent_runs', 'business_value_cents', 'incident_rate'],
  };
}

module.exports = {
  buildEnterpriseAgentRollout,
};
