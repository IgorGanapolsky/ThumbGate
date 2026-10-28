#!/usr/bin/env node
'use strict';

/**
 * CLI & SOW Orchestrator for Herdr Multi-Agent Swarm (Broadcast Deduplication + MoE + LLM-as-Judge).
 *
 * Usage:
 *   node scripts/herdr-swarm-sow.js --prompt "new SOWs for our project work..." --agent antigravity --json
 */

const {
  HERDR_MOE_EXPERTS,
  generateSwarmSow,
  evaluateSwarmCandidatesWithJudge,
  inspectLiveHerdrSwarm,
} = require('../src/herdr-moe-swarm');

function parseArgs(argv) {
  const out = {
    prompt: 'Coordinate multi-agent swarm inside Herdr with Broadcast Prompt Deduplication, Mixture-of-Experts routing, and 2-Stage LLM-as-Judge verification',
    agent: process.env.THUMBGATE_AGENT_NAME || 'antigravity',
    workspace: process.env.HERDR_WORKSPACE_ID || 'w3',
    json: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      out.json = true;
    } else if (arg === '--prompt' && argv[i + 1]) {
      out.prompt = argv[++i];
    } else if (arg === '--agent' && argv[i + 1]) {
      out.agent = argv[++i];
    } else if (arg === '--workspace' && argv[i + 1]) {
      out.workspace = argv[++i];
    }
  }
  return out;
}

if (require.main === module) {
  const args = parseArgs(process.argv);
  const sow = generateSwarmSow({
    prompt: args.prompt,
    callingAgent: args.agent,
    workspaceId: args.workspace,
  });
  const liveHerdr = inspectLiveHerdrSwarm({ workspaceId: args.workspace });
  const judgeDemo = evaluateSwarmCandidatesWithJudge([
    {
      agent: 'omp',
      seatId: 'architect@herdr',
      tokensUsed: 4100,
      latencyMs: 1420,
      filesModified: ['src/herdr-moe-swarm.js', 'src/api/server.js'],
      testsPassed: true,
      output: 'Verified SOW router and broadcast prompt SHA-256 deduplicator with sha256 commit receipt and unit test suite pass.',
    },
    {
      agent: 'antigravity',
      seatId: 'builder@herdr',
      tokensUsed: 3650,
      latencyMs: 1180,
      filesModified: ['src/admin-cloud-portal.js', 'public/dashboard.html', 'scripts/herdr-swarm-sow.js'],
      testsPassed: true,
      output: 'Implemented Herdr MoE Swarm UI panel on Google Cloud Run /admin and fixed single-line navbar UX. Verified with tests and health check.',
    },
    {
      agent: 'gemini-flash',
      seatId: 'verifier@herdr',
      tokensUsed: 1250,
      latencyMs: 640,
      filesModified: ['tests/herdr-moe-swarm.test.js'],
      testsPassed: true,
      output: 'Verified 100% pass across herdr-moe-swarm.test.js and admin-cloud-portal.test.js with deterministic proof.',
    },
  ]);

  const report = {
    ok: true,
    sow,
    liveHerdr,
    judgeEvaluation: judgeDemo,
    expertsCount: HERDR_MOE_EXPERTS.length,
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`=== Herdr MoE Swarm SOW (${sow.sowId}) ===\n`);
    process.stdout.write(`Broadcast Hash: ${sow.promptHash} (${sow.deduplicationStatus})\n`);
    process.stdout.write(`Assigned Seat:  ${sow.assignedSeatId} (${sow.assignedSlice.herdrPane})\n`);
    process.stdout.write(`Token Savings:  ${sow.tokenEfficiency.tokenSavingsPct}% (${sow.tokenEfficiency.tokensSaved.toLocaleString()} tokens saved)\n`);
    process.stdout.write(`Judge Winner:   ${judgeDemo.winner.agent} (${judgeDemo.winner.seatId}) score=${judgeDemo.winner.finalScore}\n`);
  }
}
