#!/usr/bin/env node
'use strict';

/**
 * Ensure hosted production volumes always have a minimal searchable corpus
 * for the deploy proof query ("thumbgate").
 *
 * Railway containers ship without .claude/memory/feedback. Ephemeral /data
 * volumes can leave /v1/search and /v1/lessons/search returning zero hits even
 * when /health is green — which fails GHA "Verify authenticated production
 * behavior" while the release is otherwise live.
 *
 * Idempotent: only appends missing seed rows; never rewrites customer data.
 */

const fs = require('node:fs');
const path = require('node:path');

const SEED_ID = 'seed_deploy_proof_thumbgate_v1';
const SEED_FEEDBACK_ID = 'fb_seed_deploy_proof_thumbgate_v1';
const SEED_RULE_HEADING = '## ThumbGate deploy-proof prevention seed';


function shouldEnsureProductionSearchCorpus(env = process.env) {
  if (String(env.THUMBGATE_SKIP_SEARCH_CORPUS_SEED || '').trim() === '1') return false;
  if (String(env.THUMBGATE_ENSURE_SEARCH_CORPUS || '').trim() === '1') return true;
  // Hosted deploy surfaces only — never seed local/temp/E2E feedback dirs.
  return Boolean(
    env.RAILWAY_ENVIRONMENT
    || env.RAILWAY_VOLUME_MOUNT_PATH
    || env.K_SERVICE
    || env.CLOUD_RUN_JOB
  );
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function appendLine(filePath, line) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${line}\n`, 'utf8');
}

function fileContains(filePath, needle) {
  return readText(filePath).includes(needle);
}

function buildSeedMemory(nowIso) {
  return {
    id: SEED_ID,
    timestamp: nowIso,
    category: 'learning',
    title: 'ThumbGate infrastructure firewall deploy-proof seed',
    content: [
      'ThumbGate is the infrastructure firewall for AI coding agents.',
      'Capture feedback, promote lessons, generate prevention rules, and block known-bad tool calls.',
      'This seed keeps production /v1/search and /v1/lessons/search non-empty for the thumbgate proof query.',
    ].join(' '),
    whatWorked: 'Keep a durable searchable ThumbGate seed so deploy authenticated proof can verify retrieval.',
    whatToChange: 'Do not delete seed_deploy_proof_thumbgate_v1 from the production feedback volume.',
    tags: ['thumbgate', 'deploy-proof', 'seed', 'retrieval'],
    importance: 0.9,
    sourceFeedbackId: SEED_FEEDBACK_ID,
  };
}

function buildSeedFeedback(nowIso) {
  return {
    id: SEED_FEEDBACK_ID,
    timestamp: nowIso,
    signal: 'up',
    feedback: 'up',
    title: 'ThumbGate deploy proof seed feedback',
    context: 'ThumbGate production must keep a searchable thumbgate corpus for authenticated deploy proof.',
    whatWorked: 'Seed prevention rules and memory so hybrid-parent-child search returns at least one hit.',
    tags: ['thumbgate', 'deploy-proof', 'seed'],
  };
}

function buildSeedRulesBlock() {
  return [
    SEED_RULE_HEADING,
    '',
    '- ALWAYS keep a minimal ThumbGate-searchable corpus on the production feedback volume.',
    '- NEVER claim production retrieval is healthy when /v1/search?q=thumbgate returns zero results.',
    '- Deploy proof depends on hybrid-parent-child search + lesson evidence for the query "thumbgate".',
    '',
  ].join('\n');
}

/**
 * @param {object} options
 * @param {string} options.feedbackDir
 * @param {string} [options.nowIso]
 * @returns {{feedbackDir:string,wrote:{memory:boolean,feedback:boolean,rules:boolean},paths:object}}
 */
function ensureProductionSearchCorpus(options = {}) {
  const feedbackDir = path.resolve(String(options.feedbackDir || '').trim());
  if (!feedbackDir) {
    throw new Error('feedbackDir is required');
  }

  const nowIso = options.nowIso || new Date().toISOString();
  ensureDir(feedbackDir);

  const paths = {
    memoryLog: path.join(feedbackDir, 'memory-log.jsonl'),
    feedbackLog: path.join(feedbackDir, 'feedback-log.jsonl'),
    preventionRules: path.join(feedbackDir, 'prevention-rules.md'),
  };

  const wrote = { memory: false, feedback: false, rules: false };

  if (!fileContains(paths.memoryLog, SEED_ID)) {
    appendLine(paths.memoryLog, JSON.stringify(buildSeedMemory(nowIso)));
    wrote.memory = true;
  }

  if (!fileContains(paths.feedbackLog, SEED_FEEDBACK_ID)) {
    appendLine(paths.feedbackLog, JSON.stringify(buildSeedFeedback(nowIso)));
    wrote.feedback = true;
  }

  if (!fileContains(paths.preventionRules, SEED_RULE_HEADING)) {
    const existing = readText(paths.preventionRules);
    const next = existing
      ? `${existing.replace(/\s*$/, '')}\n\n${buildSeedRulesBlock()}`
      : `# Prevention Rules\n\n${buildSeedRulesBlock()}`;
    ensureDir(path.dirname(paths.preventionRules));
    fs.writeFileSync(paths.preventionRules, next, 'utf8');
    wrote.rules = true;
  }

  return { feedbackDir, wrote, paths, seedId: SEED_ID };
}

module.exports = {
  SEED_ID,
  SEED_FEEDBACK_ID,
  SEED_RULE_HEADING,
  shouldEnsureProductionSearchCorpus,
  ensureProductionSearchCorpus,
};

if (require.main === module) {
  const feedbackDir = process.argv[2] || process.env.THUMBGATE_FEEDBACK_DIR;
  if (!feedbackDir) {
    console.error('Usage: node scripts/ensure-production-search-corpus.js <feedbackDir>');
    process.exit(2);
  }
  const result = ensureProductionSearchCorpus({ feedbackDir });
  console.log(JSON.stringify(result, null, 2));
}
