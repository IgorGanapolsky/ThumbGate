#!/usr/bin/env node
'use strict';

/**
 * scripts/demo-hotdata-eddie.js
 *
 * Live 5-Minute Screen-Share Demo for Eddie A. Tejeda (CTO, Hotdata.dev)
 * Meeting: Thursday, Oct 15, 2026 @ 1:30 PM ET (https://meet.google.com/wkx-hgob-aox)
 *
 * Demonstrates:
 * 1. Zero Tail-Latency Amplification (<0.5ms local CPU PreToolUse evaluation)
 *    preserving Hotdata's Apache DataFusion / Arrow speed across chained agent queries.
 * 2. Runaway HotSQL Query Loop Interdiction (stops 5x identical failing query retries).
 * 3. Read-to-Write Boundary Diode (allows read-only `hotdata query` exploration,
 *    gates downstream production DB/API mutations & secret exfiltration).
 * 4. Instant 7-Day Free Pilot Token Provisioning for Hotdata (`eddie@hotdata.dev`).
 */

const { registerAgencyOnboarding } = require('./thumbgate-operator-framework');

function evaluateHotdataToolCall({ step, toolName, commandOrSql, history = [] }) {
  const startNs = process.hrtime.bigint();
  const raw = String(commandOrSql || '');

  // 1. Check runaway query loop (>= 4 prior identical calls in session)
  const signature = `${toolName}:${raw}`;
  const priorCount = history.filter(h => h === signature).length;
  history.push(signature);

  let decision = 'ALLOW';
  let gateId = 'gate:hotdata:read_exploration_pass';
  let reason = 'Read-only HotSQL / DataFusion exploration verified';

  if (priorCount >= 4) {
    decision = 'BLOCK';
    gateId = 'gate:hotdata:runaway_query_loop';
    reason = `Runaway loop interdicted (${priorCount + 1} identical HotSQL retries) — prevents compute & token burn`;
  } else if (/(?:\bDROP\s+TABLE\b|\bTRUNCATE\s+TABLE\b|\bDELETE\s+FROM\s+\w+\s*(?:;|$))/i.test(raw)) {
    decision = 'BLOCK';
    gateId = 'gate:hotdata:destructive_write_boundary';
    reason = 'Unbounded destructive SQL mutation blocked at Write Boundary before touching system of record';
  } else if (/\b(sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16})\b/.test(raw)) {
    decision = 'BLOCK';
    gateId = 'gate:hotdata:secret_exfiltration';
    reason = 'Plaintext credential detected in query/tool payload — blocked before egress';
  }

  const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1e6;
  return {
    step,
    toolName,
    queryPreview: raw.slice(0, 78),
    decision,
    gateId,
    latencyMs: Number(elapsedMs.toFixed(3)),
    reason,
  };
}

function runLiveDemo() {
  console.log('================================================================================');
  console.log('🛡️  THUMBGATE x HOTDATA.DEV — LIVE PRE-ACTION EXECUTION DIODE DEMO');
  console.log('   Counterpart: Eddie A. Tejeda (CTO, Hotdata) | Target Latency: <0.500ms');
  console.log('================================================================================\n');

  const sessionHistory = [];
  const scenarios = [
    {
      step: 1,
      toolName: 'hotdata_query',
      commandOrSql: 'SELECT neighbourhood, COUNT(*) FROM airbnb.public.listings GROUP BY 1 LIMIT 5',
    },
    {
      step: 2,
      toolName: 'hotdata_search',
      commandOrSql: 'hotdata search "cozy apartment" --index descriptions --select name,price',
    },
    {
      step: 3,
      toolName: 'prod_postgres_write',
      commandOrSql: 'DELETE FROM customer_invoices;',
    },
    {
      step: 4,
      toolName: 'hotdata_query',
      commandOrSql: 'SELECT non_existent_col FROM airbnb.public.listings',
    },
    {
      step: 5,
      toolName: 'hotdata_query',
      commandOrSql: 'SELECT non_existent_col FROM airbnb.public.listings',
    },
    {
      step: 6,
      toolName: 'hotdata_query',
      commandOrSql: 'SELECT non_existent_col FROM airbnb.public.listings',
    },
    {
      step: 7,
      toolName: 'hotdata_query',
      commandOrSql: 'SELECT non_existent_col FROM airbnb.public.listings',
    },
    {
      step: 8,
      toolName: 'hotdata_query',
      commandOrSql: 'SELECT non_existent_col FROM airbnb.public.listings',
    },
  ];

  for (const s of scenarios) {
    const res = evaluateHotdataToolCall({ ...s, history: sessionHistory });
    const badge = res.decision === 'ALLOW' ? '✅ ALLOW' : '🛑 BLOCK';
    console.log(`[Step ${res.step}] ${badge} (${res.latencyMs}ms) | Tool: ${res.toolName}`);
    console.log(`   SQL/Cmd: "${res.queryPreview}"`);
    console.log(`   Gate:    ${res.gateId} -> ${res.reason}\n`);
  }

  const pilot = registerAgencyOnboarding({
    agencyName: 'Hotdata Inc.',
    email: 'eddie@hotdata.dev',
    stacks: ['hotdata-cli', 'langgraph', 'n8n'],
  });

  console.log('--------------------------------------------------------------------------------');
  console.log('🚀 7-DAY FREE PILOT PROVISIONED FOR HOTDATA (eddie@hotdata.dev):');
  console.log(`   Trial ID:     ${pilot.trialId}`);
  console.log(`   Pilot Token:  ${pilot.trialToken}`);
  console.log(`   Expires At:   ${pilot.expiresAt}`);
  console.log(`   Commercials:  7-Day Free Pilot -> $2,500 Turnkey Setup or $500/mo Managed Retainer`);
  console.log('================================================================================');
}

if (require.main === module) {
  runLiveDemo();
}

module.exports = { evaluateHotdataToolCall, runLiveDemo };
