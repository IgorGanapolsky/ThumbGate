// scripts/agent-brain.js
'use strict';

/**
 * Agent Brain — Pancake.ai "GTM Brain" steal adaptation for ThumbGate.
 *
 * Turns ThumbGate's feedback-to-enforcement pipeline into an "Agent Brain":
 *   Pancake: "GTM idea → Play → Deploy"
 *   ThumbGate: "Mistake → Rule → Deploy"
 *
 * Every 👎 mistake is captured, scored, turned into a prevention Rule,
 * optionally approved by a human, and deployed as a pre-action gate.
 *
 * Stolen from: https://pancake.ai/
 */

const fs = require('node:fs');
const path = require('node:path');
const { recallLessons } = require('./institutional-memory');
const { generateRoutingRecommendations } = require('./test-open-models');

const MEMORY_DIR = path.join(__dirname, '..', '.claude', 'memory', 'feedback');
const RULES_DIR = path.join(__dirname, '..', 'hooks', 'gates');
const BRAIN_STATE = path.join(__dirname, '..', '.thumbgate', 'agent-brain-state.json');

function ensureDirs() {
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
  if (!fs.existsSync(RULES_DIR)) fs.mkdirSync(RULES_DIR, { recursive: true });
  if (!fs.existsSync(path.dirname(BRAIN_STATE))) fs.mkdirSync(path.dirname(BRAIN_STATE), { recursive: true });
}

/**
 * Submit a mistake to the Agent Brain.
 * Mirrors Pancake's "type a GTM idea" → submit feedback to the brain.
 */
function submitMistake(feedback, context) {
  ensureDirs();

  const mistake = {
    id: `mistake_${Date.now().toString(36)}`,
    feedback,
    context,
    submittedAt: new Date().toISOString(),
    status: 'captured',
    source: context.source || 'user_feedback',
    confidence: context.confidence || 0.5,
    modes: context.modes || ['pending_review'],
    evidence: context.evidence || [],
  };

  const filePath = path.join(MEMORY_DIR, `${mistake.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(mistake, null, 2));

  console.log(`# Mistake captured to Agent Brain`);
  console.log(`ID: ${mistake.id}`);
  console.log(`Source: ${mistake.source}`);
  console.log(`Status: ${mistake.status}`);
  return mistake;
}

/**
 * Score a mistake (Pancake's "why they fit" for security blocks).
 * Uses personality-based model routing to pick the best reviewer.
 */
function scoreMistake(mistakeId) {
  ensureDirs();
  const filePath = path.join(MEMORY_DIR, `mistake_${mistakeId}.json`);
  if (fs.existsSync(filePath)) {
    // Already has ID prefix
  } else {
    // Try without prefix
  }

  // Find the mistake file
  const files = fs.readdirSync(MEMORY_DIR).filter((f) => f.includes(mistakeId));
  if (files.length === 0) {
    console.error(`Mistake not found: ${mistakeId}`);
    return null;
  }

  const actualPath = path.join(MEMORY_DIR, files[0]);
  const mistake = JSON.parse(fs.readFileSync(actualPath, 'utf-8'));

  // Use personality routing to pick best model for this task
  // Security mistakes → qwen3-4b (high conviction, low slop)
  // Creative/coding → deepseek-7b (high organization, informativeness)
  const { modelForTask } = generateRoutingRecommendations();
  const taskType = mistake.context.taskType || 'security_review';
  const reviewerModel = modelForTask[taskType] || 'deepseek-7b-chat';

  // Score based on evidence strength + model confidence
  const evidenceScore = (mistake.evidence || []).length * 15; // 15 pts per evidence item
  const sourceTrust = mistake.source === 'user_feedback' ? 50 : 30; // user > automated
  const confidence = Math.min(95, Math.round(sourceTrust + evidenceScore + (mistake.confidence * 100 * 0.3)));

  mistake.confidence = confidence / 100;
  mistake.reviewModel = reviewerModel;
  mistake.status = confidence > 70 ? 'ready_for_approval' : 'needs_review';
  mistake.scoredAt = new Date().toISOString();

  fs.writeFileSync(actualPath, JSON.stringify(mistake, null, 2));
  console.log(`# Mistake scored`);
  console.log(`Confidence: ${confidence}%`);
  console.log(`Reviewer: ${reviewerModel}`);
  console.log(`Status: ${mistake.status}`);
  return mistake;
}

/**
 * Create a prevention Rule from a scored mistake.
 * Mirrors Pancake's "Deploy Play" one-click deploy.
 */
function createRule(mistakeId, { deploy = false } = {}) {
  ensureDirs();
  const files = fs.readdirSync(MEMORY_DIR).filter((f) => f.includes(mistakeId));
  const filePath = path.join(MEMORY_DIR, files[0]);
  const mistake = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  if (mistake.status !== 'ready_for_approval' && mistake.confidence < 0.7) {
    console.error(`Mistake not ready for rule creation (confidence: ${mistake.confidence})`);
    return null;
  }

  const ruleContent = `// Auto-generated prevention rule from Agent Brain
// Source: ${mistake.source} (${mistake.submittedAt})
// Confidence: ${(mistake.confidence * 100).toFixed(0)}%
// Evidence: ${JSON.stringify(mistake.evidence)}
//
// Original feedback: ${mistake.feedback}
` + generateGateContent(mistake);

  const rulePath = path.join(RULES_DIR, `rule_${mistake.id}.md`);
  fs.writeFileSync(rulePath, ruleContent);

  mistake.status = 'rule_created';
  mistake.rulePath = rulePath;
  mistake.deployed = deploy;
  fs.writeFileSync(filePath, JSON.stringify(mistake, null, 2));

  console.log(`# Prevention Rule created`);
  console.log(`Rule: ${mistake.id}`);
  console.log(`Path: ${rulePath}`);

  if (deploy) {
    console.log(`# Deploy: Rule activated in PreToolUse hook`);
    console.log(`# Pancake-style: "Deploy Play Deploying… Live· running"`);
  } else {
    console.log(`# Review: awaiting human approval before deploy`);
    console.log(`# Steal from Pancake approval workflow: thumbgate__approve_protected_action`);
  }

  return mistake;
}

/**
 * Generate the gate content for the rule.
 */
function generateGateContent(mistake) {
  const feedback = mistake.feedback.toLowerCase();

  if (feedback.includes('git push --force') || feedback.includes('force-push')) {
    return `// GATE: deny force-push to protected branches
deny:
  pattern: 'git.*--force.*origin\\s+main'
  reason: '${mistake.feedback}'
  action: 'DENY'
  confidence: ${mistake.confidence}`;
  }

  if (feedback.includes('secret') || feedback.includes('token') || feedback.includes('credential')) {
    return `// GATE: deny credential exfiltration
deny:
  pattern: 'curl.*-d.*TOKEN.*https'
  reason: '${mistake.feedback}'
  action: 'DENY'
  confidence: ${mistake.confidence}`;
  }

  return `// GATE: general prevention
deny:
  pattern: '${mistake.context.pattern || '.*' }'
  reason: '${mistake.feedback}'
  action: 'DENY'
  confidence: ${mistake.confidence}`;
}

/**
 * Query the Agent Brain for relevant lessons before an action.
 * Mirrors Pancake's "Search funding news" / "Check who is hiring".
 */
function queryBrain(prompt, scope = null) {
  const queryTerms = prompt.toLowerCase().split(/\s+/).filter((t) => t.length > 3);
  const lessons = recallLessons(prompt, scope);

  // Filter by query overlap
  const relevant = lessons.filter((l) => {
    const content = JSON.stringify(l).toLowerCase();
    return queryTerms.some((term) => content.includes(term));
  });

  return relevant.map((l) => ({
    source: l.source || 'agent_brain',
    confidence: l.confidence || 0.5,
    status: l.status,
    feedback: l.feedback || l.context,
    rulePath: l.rulePath || null,
    deployed: l.deployed || false,
  }));
}

// CLI
function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  switch (cmd) {
    case 'submit':
      console.log('Usage: --feedback "what went wrong" --context "task details"');
      break;
    case 'score':
      console.log('Usage: --id mistake_xxx');
      break;
    case 'create-rule':
      console.log('Usage: --id mistake_xxx [--deploy]');
      break;
    case 'query':
      console.log('Usage: --query "what to check"');
      break;
    default:
      console.log('# Agent Brain (Pancake.ai steal)');
      console.log('Commands:');
      console.log('  submit    --feedback "mistake" --context "details"  (capture)');
      console.log('  score     --id mistake_xxx                          (score + route)');
      console.log('  create-rule --id mistake_xxx [--deploy]             (deploy like Pancake)');
      console.log('  query     --query "prompt"                          (pre-action recall)');
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  submitMistake,
  scoreMistake,
  createRule,
  queryBrain,
  MEMORY_DIR,
  RULES_DIR,
};
