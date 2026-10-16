'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AI_FINANCIAL_AGENT_STACK,
  evaluateWealthAdvisorGate,
  computeFreedomPlan,
  fetchOpenFinanceAccounts,
} = require('../scripts/wealth-freedom-advisor');

test('AI_FINANCIAL_AGENT_STACK: ranks OpenFinance (api.openfinance.sh/mcp) #1 followed by SimpleFIN, Teller.io, and Origin AI', async () => {
  assert.equal(AI_FINANCIAL_AGENT_STACK.length, 4);
  assert.match(AI_FINANCIAL_AGENT_STACK[0].name, /OpenFinance/);
  assert.match(AI_FINANCIAL_AGENT_STACK[1].name, /SimpleFIN/);

  const mockRes = await fetchOpenFinanceAccounts({
    apiKey: 'sk-nf-test',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          accounts: [{ id: 1, name: 'Wells Fargo Checking', mask: '7509', currentBalance: 1250, institutionName: 'Wells Fargo', status: 'active' }],
          onboarding: { accountConnected: true, mcpLinked: true },
        };
      },
    }),
  });
  assert.equal(mockRes.configured, true);
  assert.equal(mockRes.accountCount, 1);
  assert.equal(mockRes.accounts[0].mask, '7509');
});

test('evaluateWealthAdvisorGate: blocks autonomous ACH/wire/Zelle transfers and PII leaks while allowing read-only sync', () => {
  const allowRead = evaluateWealthAdvisorGate({
    toolName: 'simplefin_sync',
    action: 'read_balances',
  });
  assert.equal(allowRead.allowed, true);

  const blockAch = evaluateWealthAdvisorGate({
    toolName: 'bank_mcp',
    action: 'ach_transfer',
    commandOrPayload: { amount: 500, to: 'external' },
  });
  assert.equal(blockAch.allowed, false);
  assert.equal(blockAch.gateId, 'gate:wealth:read_only_bank_diode');

  const blockPii = evaluateWealthAdvisorGate({
    toolName: 'linkedin_post',
    action: 'publish',
    commandOrPayload: 'routing_number 063107513 account_number_full',
  });
  assert.equal(blockPii.allowed, false);
  assert.equal(blockPii.gateId, 'gate:wealth:pii_exfiltration_diode');
});

test('computeFreedomPlan: prioritizes immediate past-due bills, ringfences $375 compute credits, and orders cards by highest APR', () => {
  const plan = computeFreedomPlan({ monthlyGrossBusinessRevenueUsd: 6000 });
  assert.equal(plan.summary.urgentBillsUsd, 580.02); // BofA $150 + FPL $95.02 + CSID $85 + WF $250
  assert.equal(plan.summary.monthlyComputeRingfenceUsd, 375);
  assert.equal(plan.summary.setupsToClearAllPastDue, 1); // 1 $2,500 Operator Setup clears all urgent & past-due bills
  assert.ok(plan.summary.monthsToZeroHighAprDebt > 0 && plan.summary.monthsToZeroHighAprDebt <= 12);
  // Highest APR card (28.99% Mastercard ••8101) is Priority #1
  assert.equal(plan.stage3AvalancheOrder[0].priority, 1);
  assert.equal(plan.stage3AvalancheOrder[0].aprPct, 28.99);
});
