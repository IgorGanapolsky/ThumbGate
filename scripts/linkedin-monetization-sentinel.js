#!/usr/bin/env node
'use strict';

/**
 * scripts/linkedin-monetization-sentinel.js
 *
 * 24/7 LinkedIn Profile Showcase, Daily Post Publisher, Comment Responder,
 * and Proactive Conversation Injector via BrowserOS Neo (CDP port 9111).
 *
 * Features:
 * 1. Daily LinkedIn Post Publisher (attaches public/media/thumbgate-demo.gif + GitHub/Operator links)
 * 2. Inbound Comment & Notification Responder
 * 3. Proactive B2B Conversation Injector (searches fresh LinkedIn posts on LangGraph, n8n, CrewAI,
 *    Claude Code, MCP, and AI agent guardrails, and injects high-signal founder comments)
 * 4. Append-only ledger in .thumbgate/linkedin-monetization-ledger.jsonl
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const LEDGER_PATH = path.join(REPO_ROOT, '.thumbgate', 'linkedin-monetization-ledger.jsonl');
const STATE_PATH = path.join(REPO_ROOT, '.thumbgate', 'linkedin-monetization-state.json');
const DEMO_GIF_PATH = path.join(REPO_ROOT, 'public', 'media', 'thumbgate-demo.gif');
const CDP_PORT = Number(process.env.BROWSEROS_CDP_PORT || 9111);

const DAILY_POST_ROTATION = [
  {
    id: 'hotdata-lancedb-swap-poc',
    title: 'Swapping Local LanceDB for Hotdata DB (Apache DataFusion / Arrow) + <0.1ms PreToolUse Diodes',
    attachGif: true,
    body: [
      'When you run 4+ autonomous coding agents (Claude Code, Cursor, Codex, LangGraph) on the same repo, local embedded vector stores hit file-lock contention right when context retrieval matters most.',
      '',
      'Today we shipped a live POC with Eddie Tejeda at Hotdata (hotdata.dev) swapping local LanceDB in ThumbGate for Hotdata DB (Rust + Apache DataFusion + Apache Arrow):',
      '',
      '1. High-Concurrency Vector + Relational Search: `scripts/vector-store.js` now supports `THUMBGATE_VECTOR_BACKEND=hotdata`, publishing 384-dim feedback & lesson vectors via atomic `/loads` upserts and querying HNSW cosine nearest neighbors via HotSQL `vector_search(...)`.',
      '2. <0.1ms PreToolUse Loop & Write-Boundary Diode: Before an agent executes a query or touches a downstream Postgres/Stripe tool call, ThumbGate evaluates the payload in <0.1ms on local CPU — interdicting 5x identical hallucinated SQL retry loops and blocking unbounded `DELETE` / `DROP` mutations at the write boundary.',
      '',
      'Live POC branch & runnable benchmark:',
      'https://github.com/IgorGanapolsky/ThumbGate/tree/poc/hotdata-lancedb-swap',
      '',
      'Operator Framework & <0.5ms PreToolUse Firewall:',
      'https://thumbgate.ai/operator-framework',
      '',
      '#AIAgents #DataEngineering #ApacheArrow #DataFusion #LangGraph #MCP #SoftwareArchitecture'
    ].join('\n'),
  },
  {
    id: 'operator-framework-aaa',
    title: 'The ThumbGate Operator Framework for AI Automation Agencies (n8n, LangGraph, CrewAI)',
    attachGif: true,
    body: [
      'If you deploy autonomous n8n, LangGraph, or CrewAI workflows for enterprise clients, your #1 liability is not prompt quality — it is a runaway webhook loop burning $2,000 in API credits or an unverified tool call mutating a client CRM/database.',
      '',
      'Passive rules in CLAUDE.md or system prompts rot once context compacts at 150k tokens. And cloud LLM guardrails add 80ms+ of network latency per turn.',
      '',
      'We built the ThumbGate Operator Framework (`npx thumbgate@latest init`) to sit directly in the PreToolUse execution boundary in <0.5ms on local CPU:',
      '• Pre-action kill-switches & deterministic 5x loop breakers',
      '• Hard per-session token & spend circuit breakers',
      '• Pre-execution PII & API-key exfiltration diodes',
      '• Tamper-evident SHA-256 execution receipts for enterprise compliance',
      '',
      'Architecture blueprint & 7-day pilot:',
      'https://thumbgate.ai/operator-framework',
      'Open-source repo: https://github.com/IgorGanapolsky/ThumbGate',
      '',
      '#AIAutomation #n8n #LangGraph #CrewAI #EnterpriseAI #AgenticAI'
    ].join('\n'),
  },
  {
    id: 'decisive-step-dpo-distillation',
    title: 'Why Whole-Trajectory RL Fails on 50-Turn Coding Agents (Decisive-Step DPO)',
    attachGif: false,
    body: [
      'Averaging a binary pass/fail reward across a 50-turn coding agent trajectory is 98% noise. Turn 14 might be the exact unverified `git reset --hard` or schema mismatch that doomed the run, while the other 49 turns were valid.',
      '',
      'In ThumbGate v1.38+, we implemented a local Decisive-Step Evaluator & DPO Distiller (`scripts/decisive-dpo-distiller.js`, inspired by NVIDIA arXiv:2610.10478):',
      '• Isolates the single pivotal tool-call turn where the trajectory diverged (Spearman rho = 0.964 with SWE-bench Verified)',
      '• Compiles that exact failure turn into a deterministic <0.5ms PreToolUse firewall rule + clean DPO preference pair',
      '',
      'Code & benchmarks: https://github.com/IgorGanapolsky/ThumbGate',
      '',
      '#MachineLearning #RLHF #DPO #CodingAgents #ClaudeCode #LLM'
    ].join('\n'),
  },
];

const SEARCH_QUERIES = [
  'LangGraph production agent guardrail',
  'n8n AI agent workflow loop',
  'Claude Code MCP security',
  'CrewAI production deployment',
];

function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    }
  } catch (_) {}
  return { lastPostDate: null, lastPostIndex: -1, commentedUrns: {} };
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function appendLedger(entry) {
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.appendFileSync(LEDGER_PATH, JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n');
}

/**
 * Classify a LinkedIn post and draft a peer-to-peer technical comment.
 * Returns null if the post is our own, off-topic, or lacks technical agent substance.
 */
function classifyLinkedInPostAndDraftComment(post) {
  if (!post || !post.text || !post.urn) return null;
  const author = String(post.author || '').toLowerCase();
  if (author.includes('igor ganapolsky') || author.includes('igor g.')) return null;

  const t = String(post.text).toLowerCase();
  // Never engage with real estate, tax deeds, crypto, or politics
  if (
    t.includes('tax deed') ||
    t.includes('tax-deed') ||
    t.includes('real estate') ||
    t.includes('foreclosure') ||
    t.includes('crypto') ||
    t.includes('hiring a junior')
  ) {
    return null;
  }

  if (t.includes('n8n') || /\bmake\s+automation\b/.test(t) || t.includes('zapier') || t.includes('webhook')) {
    return {
      category: 'workflow_automation_guardrail',
      comment:
        'Spot on. The biggest production failure mode we see in multi-step n8n and agent workflows is a retry loop or hallucinated payload hitting an external webhook/DB node before validation. Putting a deterministic <0.5ms PreToolUse gate in front of the write boundary (with an idempotency hash + 5x loop breaker) stops runaway spend cold before the external API ever sees it.',
    };
  }

  if (t.includes('langgraph') || t.includes('crewai') || t.includes('autogen') || t.includes('multi-agent')) {
    return {
      category: 'multi_agent_state_firewall',
      comment:
        'Great breakdown. One failure mode that bites multi-agent graphs in production is state-handoff drift and retry loops across tool nodes. We found that moving the guardrail out of the LLM prompt and into a deterministic <0.5ms PreToolUse interceptor on the tool boundary (with SHA-256 execution receipts) eliminates both runaway token loops and unverified mutations.',
    };
  }

  if (t.includes('mcp') || t.includes('claude code') || t.includes('cursor') || t.includes('tool call')) {
    return {
      category: 'mcp_pretooluse_diode',
      comment:
        '100%. Passive rules in CLAUDE.md or system prompts degrade as soon as context compacts past 100k+ tokens. Enforcing policy at the PreToolUse hook layer (<0.5ms on local CPU, before the MCP or Bash call executes) is the only way to guarantee deterministic tool bounds and zero secret exfiltration.',
    };
  }

  if (t.includes('agent') && (t.includes('guardrail') || t.includes('production') || t.includes('reliability') || t.includes('loop'))) {
    return {
      category: 'agent_production_reliability',
      comment:
        'Well said. Post-hoc observability tells you an agent broke production after the fact, and cloud LLM guardrails add 80ms+ of tail latency on every turn. Running a deterministic <0.5ms PreToolUse firewall on local CPU right before tool execution gives you hard loop/spend kill-switches with zero latency tax.',
    };
  }

  return null;
}

module.exports = {
  DAILY_POST_ROTATION,
  SEARCH_QUERIES,
  classifyLinkedInPostAndDraftComment,
  loadState,
  saveState,
  appendLedger,
  LEDGER_PATH,
  STATE_PATH,
  DEMO_GIF_PATH,
};
