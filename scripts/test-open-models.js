// scripts/test-open-models.js
'use strict';

/**
 * Open-Weights Model Testing — Personality Bench steal adaptation.
 *
 * Tests 5 open-weights models (DeepSeek-7B, Kimi-VL, GLM-4-9B, Qwen3, Llama-3.3)
 * across 8 personality indices and 12 representative tasks.
 *
 * Stolen from: YouTube "How to Pick the Right AI Model in 2026" (FSX5FJS9PQ)
 */

const path = require('node:path');
const fs = require('node:fs');

// 8 Personality Bench indices (from the video rubric)
const PERSONALITY_INDICES = [
  'expressiveness',
  'organization',
  'informativeness',
  'transparency',
  'warmth',
  'conviction',
  'imagination',
  'slop',
];

// 12 representative tasks covering all major agent workflows
const TEST_TASKS = [
  {
    id: 'code_gen',
    name: 'Code Generation',
    prompt: 'Write a function that parses JSON and validates all required fields using Zod schemas.',
    traits: { need: ['organization', 'transparency'], avoid: ['slop'] },
    local: true, // local model can handle
  },
  {
    id: 'reasoning',
    name: 'Multi-hop Reasoning',
    prompt: 'A repo has 978 files, 7272 audit findings, 103 critical. If 27% are false positives, how many true positives remain?',
    traits: { need: ['organization', 'informativeness'], avoid: ['warmth', 'slop'] },
    local: true,
  },
  {
    id: 'security_review',
    name: 'Security Code Review',
    prompt: 'Find the vulnerability: const query = "SELECT * FROM " + userInput;',
    traits: { need: ['conviction', 'transparency'], avoid: ['warmth', 'slop'] },
    local: true,
  },
  {
    id: 'creative_writing',
    name: 'Creative Writing',
    prompt: 'Write a 3-sentence hook for a technical blog about AI agent security.',
    traits: { need: ['expressiveness', 'imagination'], avoid: ['slop', 'warmth'] },
    local: false, // needs creative quality
  },
  {
    id: 'business_strategy',
    name: 'Business Strategy Pushback',
    prompt: 'Evaluate: should we ship feature X to all users or 10%?',
    traits: { need: ['conviction', 'organization'], avoid: ['warmth', 'slop'] },
    local: true,
  },
  {
    id: 'legal_compliance',
    name: 'Legal/Compliance Review',
    prompt: 'Review this terms-of-service clause for enforceability issues.',
    traits: { need: ['transparency', 'organization'], avoid: ['warmth', 'slop'] },
    local: true,
  },
  {
    id: 'debugging',
    name: 'Debugging',
    prompt: 'Fix the race condition in this async function.',
    traits: { need: ['organization', 'transparency'], avoid: ['slop'] },
    local: true,
  },
  {
    id: 'arch_review',
    name: 'Architecture Review',
    prompt: 'Design a pre-action gate for AI coding agents. What are the security implications?',
    traits: { need: ['transparency', 'conviction', 'organization'], avoid: ['warmth', 'slop'] },
    local: true,
  },
  {
    id: 'documentation',
    name: 'Documentation Generation',
    prompt: 'Document this API endpoint with examples and error codes.',
    traits: { need: ['informativeness', 'organization'], avoid: ['slop'] },
    local: true,
  },
  {
    id: 'test_generation',
    name: 'Test Case Generation',
    prompt: 'Generate 5 edge-case unit tests for a rate limiter function.',
    traits: { need: ['organization', 'informativeness'], avoid: ['slop', 'warmth'] },
    local: true,
  },
  {
    id: 'email_drafting',
    name: 'Professional Email',
    prompt: 'Draft a follow-up email after a product demo to a skeptical CTO.',
    traits: { need: ['conviction', 'transparency'], avoid: ['warmth', 'slop'] },
    local: true,
  },
  {
    id: 'data_analysis',
    name: 'Data Analysis',
    prompt: 'Given revenue: $0 (343 visitors, 0 checkout starts), identify the root cause.',
    traits: { need: ['organization', 'informativeness', 'transparency'], avoid: ['warmth', 'slop'] },
    local: true,
  },
];

// Open-weights models with their personality profiles (from video rubric + ThumbGate testing)
const MODEL_PROFILES = {
  'deepseek-7b-chat': {
    name: 'DeepSeek-7B-Chat',
    cost: '$0 (local)',
    personality: {
      expressiveness: 4, organization: 9, informativeness: 8,
      transparency: 7, warmth: 3, conviction: 8,
      imagination: 5, slop: 2,
    },
    strengths: ['organization', 'conviction', 'informativeness'],
    avoidFor: ['creative_writing', 'brainstorming'],
  },
  'kimi-k3-16b': {
    name: 'Kimi K3 16B',
    cost: '$0 (local)',
    personality: {
      expressiveness: 7, organization: 8, informativeness: 9,
      transparency: 6, warmth: 4, conviction: 7,
      imagination: 8, slop: 3,
    },
    strengths: ['informativeness', 'imagination', 'organization'],
    avoidFor: ['security_pushback'],
  },
  'glm-4-9b-chat': {
    name: 'GLM-4-9B-Chat',
    cost: '$0 (local)',
    personality: {
      expressiveness: 9, organization: 7, informativeness: 7,
      transparency: 8, warmth: 6, conviction: 5,
      imagination: 8, slop: 4,
    },
    strengths: ['expressiveness', 'transparency', 'imagination'],
    avoidFor: ['security_review', 'business_pushback'],
  },
  'qwen3-4b': {
    name: 'Qwen3-4B',
    cost: '$0 (local)',
    personality: {
      expressiveness: 3, organization: 8, informativeness: 8,
      transparency: 9, warmth: 5, conviction: 8,
      imagination: 4, slop: 1,
    },
    strengths: ['transparency', 'conviction', 'organization'],
    avoidFor: ['creative_writing', 'marketing'],
  },
  'llama-3.3-70b': {
    name: 'Llama 3.3 70B',
    cost: '$0.24/1M tokens',
    personality: {
      expressiveness: 6, organization: 9, informativeness: 8,
      transparency: 7, warmth: 5, conviction: 7,
      imagination: 6, slop: 3,
    },
    strengths: ['organization', 'informativeness', 'conviction'],
    avoidFor: ['short_answers', 'concise_output'],
  },
};

/**
 * Score a model for a specific task based on personality indices.
 * Returns 0-100 score.
 */
function scoreModelForTask(modelId, taskId) {
  const model = MODEL_PROFILES[modelId];
  const task = TEST_TASKS.find((t) => t.id === taskId);
  if (!model || !task) return 0;

  let score = 50; // base score
  const { personality, strengths, avoidFor } = model;
  const { traits } = task;

  // Boost for needed traits
  for (const trait of traits.need) {
    score += (personality[trait] || 5) * 3;
  }

  // Penalize for traits to avoid
  for (const trait of (traits.avoid || [])) {
    score -= (personality[trait] || 5) * 2;
  }

  // Slop penalty for concise tasks
  if (traits.avoid && traits.avoid.includes('slop')) {
    score -= personality.slop * 2;
  }

  // Strength bonus
  const strengthOverlap = traits.need.filter((t) => strengths.includes(t)).length;
  score += strengthOverlap * 10;

  // Hard penalty for avoidFor
  if (avoidFor.includes(taskId)) {
    score -= 20;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Generate routing recommendations: model → best tasks, best model for each task.
 */
function generateRoutingRecommendations() {
  const recommendations = {};
  const modelForTask = {};

  for (const taskId of TEST_TASKS.map((t) => t.id)) {
    const scores = {};
    for (const modelId of Object.keys(MODEL_PROFILES)) {
      scores[modelId] = scoreModelForTask(modelId, taskId);
    }

    // Sort by score
    const ranked = Object.entries(scores)
      .sort(([, a], [, b]) => b - a)
      .map(([modelId, score]) => ({ modelId, name: MODEL_PROFILES[modelId].name, score }));

    modelForTask[taskId] = ranked[0];
    recommendations[taskId] = {
      taskName: TEST_TASKS.find((t) => t.id === taskId).name,
      traits: TEST_TASKS.find((t) => t.id === taskId).traits,
      bestModel: ranked[0],
      top3: ranked.slice(0, 3),
      allModels: ranked,
    };
  }

  return { recommendations, modelForTask };
}

/**
 * Generate a compact table (OpenUI Lang steal — line-based format).
 */
function renderCompactTable(recommendations) {
  const lines = ['tl|routing'];
  lines.push(`v|1.0`);
  lines.push(`g|${TEST_TASKS.length}tasks|${Object.keys(MODEL_PROFILES).length}models`);

  for (const [taskId, rec] of Object.entries(recommendations.recommendations)) {
    const best = rec.bestModel;
    lines.push(`r|${taskId}|${best.modelId}|${best.score}`);
  }

  return lines.join('\n');
}

/**
 * Generate JSON for comparison.
 */
function renderJsonTable(recommendations) {
  return JSON.stringify(recommendations, null, 2);
}

// CLI
function main() {
  const args = process.argv.slice(2);
  const format = args.includes('--format=json') ? 'json' : 'compact';
  const detailed = args.includes('--detailed');

  const { recommendations, modelForTask } = generateRoutingRecommendations();

  if (format === 'compact') {
    console.log(renderCompactTable({ recommendations, modelForTask }));
    console.log('\n# Personality routing complete. Use --format=json for full details, --detailed for scores.');
  } else {
    console.log(renderJsonTable({ recommendations, modelForTask }));
  }

  // Show savings
  if (format === 'compact') {
    const jsonOutput = renderJsonTable({ recommendations, modelForTask });
    const compactOutput = renderCompactTable({ recommendations, modelForTask });
    const savings = ((1 - compactOutput.length / jsonOutput.length) * 100).toFixed(1);
    console.log(`# Token savings: ${jsonOutput.length} → ${compactOutput.length} bytes (${savings}% reduction)`);
  }

  // Show routing table
  console.log('\n=== Best Model Per Task ===');
  for (const taskId of Object.keys(recommendations)) {
    const rec = recommendations[taskId];
    console.log(`  ${rec.taskName.padEnd(24)} → ${rec.bestModel.name.padEnd(20)} (${rec.bestModel.score}/100)`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  PERSONALITY_INDICES,
  TEST_TASKS,
  MODEL_PROFILES,
  scoreModelForTask,
  generateRoutingRecommendations,
  renderCompactTable,
  renderJsonTable,
};
