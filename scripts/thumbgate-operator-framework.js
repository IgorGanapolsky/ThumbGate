#!/usr/bin/env node
'use strict';

/**
 * scripts/thumbgate-operator-framework.js
 *
 * Productized B2B Engine: The ThumbGate Operator Framework for AI Automation Agencies (AAAs).
 *
 * 1. Offer Architecture:
 *    - Target: AI Automation Agencies building n8n, LangGraph, and CrewAI swarms for corporate clients.
 *    - Core Transformation: Plug-and-play pre-action gateway (<0.5ms), hard token/spend caps,
 *      and tool-call kill-switches (preventing unauthorized DB deletes or runaway API loops).
 *    - Pricing: $2,500 one-time Operator Setup OR $500/month recurring Agency Infrastructure Retainer.
 *
 * 2. Profit First Allocation Engine (95% software margin):
 *    - Owner's Pay: 80% ($6,000/mo on $7,500 gross)
 *    - Tax Lockbox: 15% ($1,125/mo on $7,500 gross)
 *    - Operating Expenses (OpEx): 5% ($375/mo on $7,500 gross)
 *
 * 3. Autonomous Self-Onboarding Registration Route & n8n/LangGraph/CrewAI Blueprint Generator:
 *    - Registers agency trial tenants in .thumbgate/agency-onboarding-ledger.jsonl
 *    - Issues a scoped 7-day trial token and generates stack-specific middleware snippets.
 *
 * Usage:
 *   node scripts/thumbgate-operator-framework.js [--json] [--onboard="Agency Name" --email="founder@agency.io" --stack="n8n,langgraph"]
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REPO_ROOT = path.resolve(__dirname, '..');
const ONBOARDING_LEDGER_PATH = process.env.THUMBGATE_AGENCY_LEDGER_PATH || path.join(REPO_ROOT, '.thumbgate', 'agency-onboarding-ledger.jsonl');

const PROFIT_FIRST_RATIOS = Object.freeze({
  ownersPayPct: 0.80,
  taxLockboxPct: 0.15,
  opExPct: 0.05,
});

const OFFER_TIERS = Object.freeze({
  trial7Day: {
    id: 'operator-trial-7d',
    name: '7-Day Free Operator Blueprint Trial',
    priceUsd: 0,
    billing: '7-day-trial',
    ctaUrl: 'https://thumbgate.ai/operator-framework?trial=7d',
  },
  monthlyRetainer: {
    id: 'operator-retainer-500',
    name: 'ThumbGate Agency Infrastructure Retainer',
    priceUsd: 500,
    billing: 'monthly',
    ctaUrl: 'https://thumbgate.ai/go/pro?tier=agency-500&utm_source=operator_framework',
  },
  oneTimeSetup: {
    id: 'operator-setup-2500',
    name: 'ThumbGate Operator Framework Turnkey Setup',
    priceUsd: 2500,
    billing: 'one-time',
    ctaUrl: 'https://thumbgate.ai/go/sprint?tier=operator-2500&utm_source=operator_framework',
  },
});

/**
 * Compute strict Profit First allocations (80% Owner's Pay, 15% Tax Lockbox, 5% OpEx).
 */
function calculateProfitFirstAllocation(grossRevenueUsd = 7500) {
  const gross = Number(grossRevenueUsd);
  if (!Number.isFinite(gross) || gross < 0) {
    throw new Error('grossRevenueUsd must be a non-negative finite number');
  }

  const ownersPayUsd = Math.round(gross * PROFIT_FIRST_RATIOS.ownersPayPct * 100) / 100;
  const taxLockboxUsd = Math.round(gross * PROFIT_FIRST_RATIOS.taxLockboxPct * 100) / 100;
  const opExUsd = Math.round(gross * PROFIT_FIRST_RATIOS.opExPct * 100) / 100;

  return {
    grossRevenueUsd: gross,
    allocations: {
      ownersPay: { pct: 80, amountUsd: ownersPayUsd },
      taxLockbox: { pct: 15, amountUsd: taxLockboxUsd },
      opEx: { pct: 5, amountUsd: opExUsd },
    },
    clientsNeededAt2500Setup: Math.ceil(7500 / OFFER_TIERS.oneTimeSetup.priceUsd),
    clientsNeededAt500Monthly: Math.ceil(7500 / OFFER_TIERS.monthlyRetainer.priceUsd),
    meets6kNetTarget: ownersPayUsd >= 6000,
  };
}

/**
 * Generate personalized B2B outreach message for an AI Automation Agency owner.
 */
function generateAgencyOutreachScript({ founderName = 'there', stack = 'n8n and LangGraph' } = {}) {
  return `Hey ${founderName}, I see your agency is deploying multi-agent loops for enterprise clients. I'm the creator of ThumbGate, and we just rolled out a plug-and-play infrastructure gateway that adds hard token caps and tool-call kill-switches to ${stack} workflows to prevent runaway API spend and unauthorized DB mutations. If you want to make your agent networks 100% corporate-safe, I can hand you our core blueprint to test free for 7 days—sound fair?`;
}

/**
 * Generate stack-specific integration blueprint for n8n, LangGraph, and CrewAI.
 */
function generateIntegrationBlueprint() {
  return {
    title: 'ThumbGate Operator Framework — 1-Page Agency Integration Blueprint',
    latencyBudget: '<0.5ms local CPU / <15ms edge webhook',
    stacks: {
      n8n: {
        hookPoint: 'Pre-Execution HTTP Request Node / Custom n8n Community Node before Tool/DB/API execution',
        endpoint: 'POST https://thumbgate-production.up.railway.app/v1/gates/evaluate',
        payloadExample: {
          workflowId: '{{ $workflow.id }}',
          agentRole: 'n8n-production-worker',
          toolName: 'postgres_execute_query',
          toolArgs: { query: '{{ $json.sqlQuery }}', maxTokenBudgetUsd: 5.0 },
        },
        killSwitchBehavior: 'Returns { decision: "block", reason: "destructive_sql_or_token_cap_exceeded" } -> routes n8n IF node to Human Escalation Slack webhook instead of executing query.',
      },
      langgraph: {
        hookPoint: 'LangGraph ToolNode pre-invocation wrapper (interrupt_before=["tools"] or custom ToolNode diode)',
        codeSnippet: [
          'def thumbgate_tool_diode(state, tool_call):',
          '    verdict = thumbgate.evaluate(tool_name=tool_call["name"], args=tool_call["args"], max_Loops=5)',
          '    if verdict["decision"] == "block":',
          '        raise ToolExecutionBlockedError(verdict["reason"])',
          '    return execute_tool(tool_call)',
        ].join('\n'),
      },
      crewai: {
        hookPoint: 'CrewAI @before_tool_call hook / step_callback',
        codeSnippet: [
          'def thumbgate_step_guard(step_output):',
          '    if step_output.token_spend_usd > 2.50 or is_destructive_mutation(step_output.tool_input):',
          '        return thumbgate.halt_and_escalate(step_output)',
        ].join('\n'),
      },
    },
  };
}

/**
 * Self-onboard an AI Automation Agency for a 7-day trial and persist receipt.
 */
function registerAgencyOnboarding(input = {}) {
  const agencyName = String(input.agencyName || '').trim();
  const email = String(input.email || '').trim();
  const stacks = Array.isArray(input.stacks)
    ? input.stacks
    : String(input.stacks || 'n8n,langgraph').split(',').map(s => s.trim()).filter(Boolean);

  if (!agencyName || !email || !email.includes('@')) {
    return {
      ok: false,
      status: 400,
      error: 'Valid agencyName and business email are required for self-onboarding.',
    };
  }

  const trialId = `tg_aaa_${crypto.randomBytes(6).toString('hex')}`;
  const trialToken = `tg_trial_${crypto.randomBytes(16).toString('hex')}`;
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const record = {
    trialId,
    agencyName,
    email,
    stacks,
    tier: OFFER_TIERS.trial7Day.id,
    upgradeOptions: [OFFER_TIERS.monthlyRetainer, OFFER_TIERS.oneTimeSetup],
    trialTokenPreview: `${trialToken.slice(0, 14)}...`,
    createdAt,
    expiresAt,
    blueprint: generateIntegrationBlueprint(),
  };

  fs.mkdirSync(path.dirname(ONBOARDING_LEDGER_PATH), { recursive: true });
  fs.appendFileSync(ONBOARDING_LEDGER_PATH, JSON.stringify(record) + '\n', 'utf8');

  return {
    ok: true,
    status: 201,
    ...record,
    trialToken,
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const onboardArg = args.find(a => a.startsWith('--onboard='));
  const emailArg = args.find(a => a.startsWith('--email='));
  const stackArg = args.find(a => a.startsWith('--stack='));

  if (onboardArg && emailArg) {
    const res = registerAgencyOnboarding({
      agencyName: onboardArg.slice('--onboard='.length),
      email: emailArg.slice('--email='.length),
      stacks: stackArg ? stackArg.slice('--stack='.length) : 'n8n,langgraph,crewai',
    });
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.ok ? 0 : 1);
  }

  const report = {
    ok: true,
    offerTiers: OFFER_TIERS,
    profitFirst7500Gross: calculateProfitFirstAllocation(7500),
    sampleOutreachScript: generateAgencyOutreachScript({ founderName: 'Alex', stack: 'n8n and LangGraph' }),
    blueprint: generateIntegrationBlueprint(),
  };
  console.log(JSON.stringify(report, null, 2));
}

module.exports = {
  PROFIT_FIRST_RATIOS,
  OFFER_TIERS,
  calculateProfitFirstAllocation,
  generateAgencyOutreachScript,
  generateIntegrationBlueprint,
  registerAgencyOnboarding,
};
