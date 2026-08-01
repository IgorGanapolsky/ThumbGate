#!/usr/bin/env node
'use strict';

const path = require('node:path');

/**
 * Golden-set regression eval for the rerank pipeline.
 *
 * Measures:
 *   - Precision@1 / MRR on planted force-push / secret / deploy cases
 *   - Rank-delta rate (how often #1 flips vs first-stage order)
 *   - Stage presence (BM25, MaxSim, heuristic CE)
 *
 * Exit 0 when bounded deterministic floors are met. Provider holdouts and live
 * traces are separate A+ requirements.
 */

const { rerankPipelineSync, PIPELINE_VERSION } = require('./rerank-pipeline');

const GOLDEN = [
  {
    id: 'force-push',
    query: 'git push --force to main',
    toolName: 'Bash',
    // first-stage order intentionally wrong (decoy first)
    candidates: [
      { id: 'decoy-deploy', title: 'Friday deploys', content: 'Ship every Friday', relevanceScore: 0.99 },
      {
        id: 'gold-force',
        title: 'Force push blocked',
        whatWentWrong: 'force push to main wiped history',
        tags: ['git', 'force-push', 'negative'],
        signal: 'negative',
        relevanceScore: 0.2,
        metadata: { toolsUsed: ['Bash'] },
      },
      { id: 'noise-weather', title: 'Weather', content: 'Paris is rainy', relevanceScore: 0.5 },
    ],
    relevantIds: ['gold-force'],
  },
  {
    id: 'secrets-env',
    query: 'commit .env with API keys',
    toolName: 'Bash',
    candidates: [
      { id: 'decoy-readme', title: 'Update README', content: 'docs only', relevanceScore: 0.9 },
      {
        id: 'gold-secret',
        title: 'Never commit secrets',
        whatWentWrong: 'committed .env with api key token credential',
        tags: ['secret', 'env', 'security'],
        signal: 'negative',
        relevanceScore: 0.25,
      },
    ],
    relevantIds: ['gold-secret'],
  },
  {
    id: 'rm-rf',
    query: 'rm -rf production data',
    toolName: 'Bash',
    candidates: [
      { id: 'decoy-test', title: 'Run unit tests', content: 'npm test passes', relevanceScore: 0.85 },
      {
        id: 'gold-rm',
        title: 'Destructive delete blocked',
        whatWentWrong: 'rm -rf wiped production database directory',
        tags: ['delete', 'destructive'],
        signal: 'negative',
        relevanceScore: 0.3,
      },
    ],
    relevantIds: ['gold-rm'],
  },
];

function evaluate() {
  let hitsAt1 = 0;
  let mrr = 0;
  let flips = 0;
  const rows = [];

  for (const caseRow of GOLDEN) {
    const firstStageTop = caseRow.candidates[0]?.id;
    const { results, meta } = rerankPipelineSync(caseRow.query, caseRow.candidates, {
      topK: 3,
      toolName: caseRow.toolName,
    });
    const topId = results[0]?.id;
    const relevant = new Set(caseRow.relevantIds);
    const hit1 = relevant.has(topId);
    if (hit1) hitsAt1 += 1;

    let rr = 0;
    for (let i = 0; i < results.length; i += 1) {
      if (relevant.has(results[i].id)) {
        rr = 1 / (i + 1);
        break;
      }
    }
    mrr += rr;
    if (meta.rankDelta?.flipped || (firstStageTop && topId && firstStageTop !== topId)) flips += 1;

    rows.push({
      id: caseRow.id,
      topId,
      hitAt1: hit1,
      mrr: rr,
      stages: meta.stages,
      flipped: Boolean(meta.rankDelta?.flipped || (firstStageTop !== topId)),
    });
  }

  const n = GOLDEN.length;
  const report = {
    pipelineVersion: PIPELINE_VERSION,
    cases: n,
    precisionAt1: hitsAt1 / n,
    mrr: mrr / n,
    rankDeltaRate: flips / n,
    floors: {
      precisionAt1: 1.0,
      mrr: 1.0,
      rankDeltaRateMin: 0.5,
    },
    rows,
  };

  report.pass =
    report.precisionAt1 >= report.floors.precisionAt1 &&
    report.mrr >= report.floors.mrr &&
    report.rankDeltaRate >= report.floors.rankDeltaRateMin;

  return report;
}

function main() {
  const report = evaluate();
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) {
    console.error('rerank-quality-eval: FAILED floors');
    process.exit(1);
  }
  console.error('rerank-quality-eval: PASS (bounded golden floors met)');
}

function isCliEntrypoint(argv = process.argv) {
  return Boolean(argv[1]) && path.resolve(argv[1]) === path.resolve(__filename);
}

if (isCliEntrypoint()) {
  main();
}

module.exports = { evaluate, GOLDEN, isCliEntrypoint };
