#!/usr/bin/env node
'use strict';

/**
 * Lightweight Procedural Graph CLI (`node scripts/procedural-graph-cli.js`)
 * Wraps compiled YAML procedural skill graphs in a deterministic CLI tool so agents
 * hand off routing and hard policy checks to programmatic execution.
 *
 * Usage:
 *   node scripts/procedural-graph-cli.js compile <path-to-SKILL.md> [--task-type <type>] [--json]
 *   node scripts/procedural-graph-cli.js run --graph-id <id> [--context '{"policyCompliant":true}'] [--json]
 *   node scripts/procedural-graph-cli.js audit [--graph-id <id>] [--json]
 */

const fs = require('fs');
const path = require('path');
const {
  compileSkillToGraphYaml,
  executeProceduralGraph,
  planRevolutSelfHostedGlmEconomics,
  evaluateNextPhaseAgenticReadiness,
  runBlumenfeldGraphEngineeringPipeline,
  auditGraphGovernance,
} = require('../src/procedural-graph-engine');

function parseArgs(argv) {
  const args = { command: argv[2] || 'audit', positional: [], flags: {} };
  for (let i = 3; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--json') {
      args.flags.json = true;
    } else if (token.startsWith('--')) {
      const key = token.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      args.flags[key] = val;
    } else {
      args.positional.push(token);
    }
  }
  return args;
}

function main() {
  const parsed = parseArgs(process.argv);
  const graphFile = parsed.flags['graph-store'] || undefined;

  if (parsed.command === 'compile') {
    const skillPath =
      parsed.positional[0] ||
      parsed.flags.skill ||
      path.join(__dirname, '..', '.agent', 'skills', 'checkout-recovery', 'SKILL.md');
    const resolved = path.resolve(skillPath);
    if (!fs.existsSync(resolved)) {
      console.error(`Error: SKILL.md not found at ${resolved}`);
      process.exit(1);
    }
    const md = fs.readFileSync(resolved, 'utf8');
    const res = compileSkillToGraphYaml(
      {
        skillMarkdown: md,
        skillPath: resolved,
        taskType: parsed.flags['task-type'] || 'policy_compliance',
      },
      graphFile
    );
    if (parsed.flags.json) {
      process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    } else {
      process.stdout.write(res.yaml);
    }
    return;
  }

  if (parsed.command === 'run') {
    let context = {};
    if (parsed.flags.context) {
      try {
        context = JSON.parse(parsed.flags.context);
      } catch (_e) {
        context = {};
      }
    }
    const res = executeProceduralGraph(
      {
        graphId: parsed.flags['graph-id'],
        context,
      },
      graphFile
    );
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    process.exit(res.ok && res.run && res.run.verdict === 'ALLOW' ? 0 : 2);
  }

  if (parsed.command === 'revolut') {
    const res = planRevolutSelfHostedGlmEconomics({
      monthlyTokensMillions: parsed.flags.tokens,
      concurrentUsers: parsed.flags.users,
      perUserContextGb: parsed.flags['context-gb'],
    });
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    return;
  }

  if (parsed.command === 'next-phase') {
    const res = evaluateNextPhaseAgenticReadiness(
      {
        graphId: parsed.flags['graph-id'],
        pendingGoal: parsed.flags.goal,
      },
      graphFile
    );
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    return;
  }

  if (parsed.command === 'pipeline') {
    const skillPath =
      parsed.positional[0] ||
      parsed.flags.skill ||
      path.join(__dirname, '..', '.agent', 'skills', 'procedural-graph-engineering', 'SKILL.md');
    const resolved = path.resolve(skillPath);
    const md = fs.existsSync(resolved) ? fs.readFileSync(resolved, 'utf8') : '';
    const res = runBlumenfeldGraphEngineeringPipeline(
      {
        skillMarkdown: md,
        skillPath: resolved,
        taskType: parsed.flags['task-type'] || 'policy_compliance',
        pendingGoal: parsed.flags.goal || 'Autonomous multi-step verification',
      },
      graphFile
    );
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    return;
  }

  const auditRes = auditGraphGovernance(
    { graphId: parsed.flags['graph-id'] },
    graphFile
  );
  process.stdout.write(JSON.stringify(auditRes, null, 2) + '\n');
}

if (require.main === module) {
  main();
}
