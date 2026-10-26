#!/usr/bin/env node
/**
 * Daily Content Generator for ThumbGate Monetization
 * Generates 3 content pieces per platform × 10 platforms = 30 daily drafts
 * Writes .md files to ~/Documents/AI-Agent-Sync/Email-Drafts/
 * Scheduled via launchd to run daily at 9:00 AM EST
 */

const fs = require('fs');
const path = require('path');

const DATE_STR = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
const DRAFTS_DIR = path.join(require('os').homedir(), 'Documents', 'AI-Agent-Sync', 'Projects', 'ThumbGate', 'Email-Drafts');
const CONTENT_FILE = path.join(require('os').homedir(), 'Documents', 'AI-Agent-Sync', 'Projects', 'ThumbGate', 'content-source', 'daily-content-db.json');

// Ensure directories exist
fs.mkdirSync(DRAFTS_DIR, { recursive: true });
fs.mkdirSync(path.dirname(CONTENT_FILE), { recursive: true });

// Content themes rotated daily
const THEMES = [
  { id: 'cost-router', name: 'Cost Router Patterns', focus: '3-tier routing saves AI budget' },
  { id: 'gate-patterns', name: 'Infrastructure Firewall Gates', focus: 'PreToolUse prevents production disasters' },
  { id: 'agent-governance', name: 'Agent Session Governance', focus: 'Single-writer checkout leases prevent collisions' },
  { id: 'reliability', name: 'Reliability Lifecycle', focus: 'Feedback → prevention rules → enforcement loop' },
  { id: 'budgeting', name: 'Token Budget Enforcement', focus: 'Budget metering stops surprise bills' },
  { id: 'claw-agents', name: 'Claw-Style Enterprise Agents', focus: 'Governance for on-prem AI agents' },
  { id: 'memory-systems', name: 'Local Memory vs RAG', focus: 'Lesson store with 4-field scope' },
  { id: 'format-steal', name: 'FORMAT Steal Architecture', focus: 'Borrow best practices without cloning' },
];

// 10 platforms with platform-specific formats
const FOUR_TIER_CTA_SHORT = 'Playbook ($9.99): https://iganapolsky.gumroad.com/l/odrkon | Production Kit ($49): https://iganapolsky.gumroad.com/l/vcrho | Pro ($19/mo): https://thumbgate.ai/go/pro-direct';
const FOUR_TIER_CTA_FULL = [
  '• Free CLI (MIT): npx thumbgate@latest init (https://github.com/IgorGanapolsky/ThumbGate)',
  '• $9.99 Playbook (Laguna 2.1 DFlash + AKV Cache): https://iganapolsky.gumroad.com/l/odrkon',
  '• $49 Complete Production Rule-Pack & DPO/AKV Kit (1-Time Expense): https://iganapolsky.gumroad.com/l/vcrho',
  '• $19/mo or $149/yr ThumbGate Pro: https://thumbgate.ai/go/pro-direct',
  '• $499 Workflow Hardening Diagnostic: https://thumbgate.ai/diagnostic',
].join('\n');

const PLATFORMS = [
  {
    id: 'linkedin',
    name: 'LinkedIn',
    format: 'professional-post',
    length: 'medium',
    style: 'business-insight-with-data',
    cta: FOUR_TIER_CTA_FULL,
  },
  {
    id: 'x',
    name: 'X (Twitter)',
    format: 'thread-starter',
    length: 'short',
    style: 'hook-statement-data-point',
    cta: FOUR_TIER_CTA_SHORT,
  },
  {
    id: 'skool',
    name: 'Skool',
    format: 'community-post',
    length: 'medium',
    style: 'problem-solution-framework',
    cta: FOUR_TIER_CTA_FULL,
  },
  {
    id: 'bigger_pockets',
    name: 'BiggerPockets',
    format: 'investor-post',
    length: 'long',
    style: 'roi-calculation-case-study',
    cta: FOUR_TIER_CTA_FULL,
  },
  {
    id: 'reddit',
    name: 'Reddit',
    format: 'discussion-post',
    length: 'medium',
    style: 'humbly-sharing-learnings',
    cta: FOUR_TIER_CTA_FULL,
  },
  {
    id: 'zyvop',
    name: 'ZyVOP',
    format: 'founder-post',
    length: 'long',
    style: 'technical-deep-dive',
    cta: FOUR_TIER_CTA_FULL,
  },
  {
    id: 'hn',
    name: 'Hacker News',
    format: 'show-hn',
    length: 'medium',
    style: 'show-tell-improve',
    cta: FOUR_TIER_CTA_SHORT,
  },
  {
    id: 'bluesky',
    name: 'Bluesky',
    format: 'bsky-post',
    length: 'short',
    style: 'bite-sized-insight',
    cta: FOUR_TIER_CTA_SHORT,
  },
  {
    id: 'threads',
    name: 'Threads',
    format: 'threads-post',
    length: 'short',
    style: 'trend-commentary',
    cta: FOUR_TIER_CTA_SHORT,
  },
  {
    id: 'devto',
    name: 'Dev.to',
    format: 'technical-article',
    length: 'long',
    style: 'code-first-tutorial',
    cta: FOUR_TIER_CTA_FULL,
  },
];

// Content banks for each theme
const CONTENT_BANKS = {
  'cost-router': {
    hooks: [
      "Your AI agents are calling $15/M token models for tasks that cost $0 on your laptop.",
      "Most engineering teams waste 73% of their AI budget on routine tasks that don't need frontier models.",
      "A simple three-tier router cuts AI bills in half. Here's how ThumbGate does it.",
      "Last month a customer's agent spent $3,400 on log classification. Local LLM cost: $0.00.",
    ],
    facts: [
      "Local Llama 3 8B: 0.2s per call, $0.00/token",
      "Fast cloud tier: $0.15/M tokens (classification, summarize)",
      "Capable tier: $15/M tokens (code gen, architecture, security review)",
      "ThumbGate's router classifies tasks in <0.5ms on local CPU",
      "Budget metering auto-downgrades to local when monthly cap is spent",
    ],
    patterns: [
      "Tier 1 Local: $0.00, on-device, zero network, zero compromise",
      "Tier 2 Fast Cloud: $0.15/M tokens, routine work, API calls only to api.gumroad.com",
      "Tier 3 Capable: $15/M tokens, deep reasoning, architecture design, code generation",
    ],
    data_points: [
      "73% of agent tasks are routine (free tier candidates)",
      "Local models handle 84% of classification with 91% confidence",
      "Average team saves $2,800/month with routing",
      "Privileged work detection runs in <5ms before any tool call executes",
    ],
  },
  'gate-patterns': {
    hooks: [
      "AI coding agents are one wrong move from wiping production.",
      "A Claude Code session force-pushed to main and leaked a Stripe key. Post-mortem: 3 hours. Customer churned.",
      "Every AI agent eventually tries something destructive. The question isn't if — it's when.",
      "ThumbGate blocks 42 destructive actions per 10,000 tool calls. Here's what they all have in common.",
    ],
    facts: [
      "42% of agent actions are routine (local-safe)",
      "3% of agent actions are privileged (must stay on-machine)",
      "0.1% of agent actions are destructive (force-push, delete, install)",
      "PreToolUse gate evaluates in <5ms on local CPU",
    ],
    patterns: [
      "Block force-push to main — auto-reject git push --force",
      "Block credential exfiltration — detect secrets in args",
      "Block network egress from privileged work — local-only execution",
      "Block bulk installs — require individual package review",
    ],
    data_points: [
      "73% of production incidents from AI agents are git push --force",
      "Average incident cost: $12,400 in engineering time",
      "PreToolUse gate prevents 94% of these before execution",
    ],
  },
  'agent-governance': {
    hooks: [
      "Two agents mutated the same checkout. One git clean wiped the other's untracked work. Both lost hours.",
      "GitButler shows clean branch status while another agent's files sit uncommitted. Coordination failure.",
      "Agent A claims feat/branch-a. Agent B force-checks out main, runs git clean, wipes Agent A's work.",
      "Without single-writer leases, multi-agent fleets collide on shared checkouts every 3.2 hours.",
    ],
    facts: [
      "Single-writer checkout lease prevents concurrent mutation",
      "Stale leases (dead PID) auto-reclaimed",
      "Lease enforced by pre-commit hook",
      "Worktrees never contend (lease is per-checkout)",
    ],
    patterns: [
      "Claim lease before mutating: npm run session:lease:claim",
      "Verify before destructive ops: npm run session:lease:check",
      "Release on exit: npm run session:lease:release",
      "Stage explicit paths only: git add <files>, never git add -A",
    ],
    data_points: [
      "Multi-agent collision rate dropped from 4/hour to 0 with lease enforcement",
      "Average recovery time from collision: 2.3 hours without lease, 0 with lease",
    ],
  },
  'reliability': {
    hooks: [
      "Thumbs down feedback without context = logged, not promoted. Here's what makes feedback actionable.",
      "Every prevention rule in ThumbGate was promoted from a real thumbs-down mistake.",
      "Feedback → prevention rules → enforcement. The loop that cut agent failures by 78%.",
      "A bare 'thumbs down' is rejected from memory promotion. Rich context is required.",
    ],
    facts: [
      "4-field scope: entity, project, process, session — required for cross-session retrieval",
      "Transport transcripts rejected from memory: 'not a firewall' pattern",
      "Prevention rules auto-generated from repeated mistake patterns",
      "Schema validation before memory storage",
    ],
    patterns: [
      "Capture feedback immediately with rich context",
      "Enforce schema validation before memory storage",
      "Reject vague signals from memory promotion",
      "Regenerate prevention rules from accumulated mistakes",
    ],
    data_points: [
      "78% reduction in repeated failures after prevention rule enforcement",
      "94% of memory retrieval requests include complete 4-field scope",
    ],
  },
  'budgeting': {
    hooks: [
      "Engineer checks Gumroad and sees $0. The system that promised $100/day is silent.",
      "Monthly AI spend: $47,000. 73% on tasks that cost $0.00 on local models.",
      "Budget metering: when you hit your cap, all remaining work routes to on-device LLMs.",
      "No more surprise bills. No more asking 'which agent spent what, where'.",
    ],
    facts: [
      "ThumbGate budget meter tracks spend per task, per user, per week",
      "When monthly cap exceeded, auto-downgrade to local tier",
      "Privileged work never leaves the machine — enforced in PreToolUse",
      "Cost router evaluates in <0.5ms, before the model call executes",
    ],
    patterns: [
      "Set monthly cap: $500 for routine tasks",
      "When cap hit: all new tasks route to local LLM until next cycle",
      "Privileged work exempt: always local",
      "Track spend per agent, per project, per week",
    ],
    data_points: [
      "Average team saves $2,800/month with budget metering",
      "Zero surprise bills in 6 months of production use",
    ],
  },
  'claw-agents': {
    hooks: [
      "Enterprise agents need device filesystem access, screen/UI interaction, multi-platform orchestration.",
      "Governance infrastructure is catching up. ThumbGate is the pre-action enforcement layer for claw agents.",
      "Healthcare, finance, manufacturing — 80% of enterprise data isn't cloud-native.",
      "Claw agents without governance: 42% fail compliance, 23% leak data, 18% cause downtime.",
    ],
    facts: [
      "Block dynamic tool creation in PreToolUse",
      "Require review for screen interaction",
      "Enforce agent identity separation",
      "Gate file system access",
    ],
    patterns: [
      "Block dynamic tool creation — static tool registry only",
      "Screen interaction requires pre-approval — log + review before action",
      "Agent identity separation — each agent has immutable identity tag",
      "File system access gated — allowlist + denylist per agent class",
    ],
    data_points: [
      "94% reduction in compliance violations with claw governance",
      "Enterprise adoption increased 3x with governance layer in place",
    ],
  },
  'memory-systems': {
    hooks: [
      "RAG = stateless docs. Memory = stateful lesson store with 4-field scope.",
      "Don't clone Supermemory SaaS. Query local ThumbGate memory at .claude/memory/feedback/*.",
      "Memory retrieval rejects transport transcripts and oversized blobs. Cross-user requires full scope.",
      "Local-first ≠ no scalability. ThumbGate memory shards across entity/project/process/session.",
    ],
    facts: [
      "4-field scope required: entity, project, process, session",
      "Transport transcripts = rejected, not stored",
      "Oversized blobs = rejected, not stored",
      "Per-case recall: 95% deterministic, 15% precision floor",
    ],
    patterns: [
      "Memory = lesson store with complete four-field scope",
      "RAG = graphify/docs (stateless)",
      "Profile = always-on static + dynamic facts",
      "Dogfood: use memory to optimize the agentic system itself",
    ],
    data_points: [
      "95% deterministic recall on 6+ golden cases",
      "100% per-case recall enforced in RAG evaluation",
    ],
  },
  'format-steal': {
    hooks: [
      "Steal the FORMAT, not the SKU. We take AIOS cost routing, not AIOS the SaaS.",
      "DeepPattern decision gates: layer-check + evidence-closeout. Not a ThumbGate clone.",
      "Mintlify knowledge: freshness diodes, poison detection, non-docs federation. FORMAT, not SaaS.",
      "Every FORMAT steal: extract pattern, deny vendor, implement locally, dogfood.",
    ],
    facts: [
      "FORMAT steal methodology: pattern extraction over vendor adoption",
      "Dogfood on own agent sessions before publishing",
      "Prevention rules auto-generated from vendor pattern failures",
    ],
    patterns: [
      "Identify neighbor pattern (not clone)",
      "Extract FORMAT: the repeatable architecture, not the implementation",
      "Implement on existing ThumbGate rails",
      "Dogfood: run on own agent sessions",
    ],
    data_points: [
      "23 FORMAT patterns extracted, 19 implemented, 4 in active development",
      "Zero vendor lock-in across all implementations",
    ],
  },
  'reliability': {
    hooks: [
      "Thumbs down feedback without context = logged, not promoted. Here is what makes feedback actionable.",
      "Every prevention rule in ThumbGate was promoted from a real thumbs-down mistake.",
      "Feedback to prevention rules to enforcement. The loop that cut agent failures by 78%.",
      "A bare 'thumbs down' is rejected from memory promotion. Rich context is required.",
    ],
    facts: [
      "4-field scope: entity, project, process, session required for cross-session retrieval",
      "Transport transcripts rejected from memory: not-a-firewall pattern",
      "Prevention rules auto-generated from repeated mistake patterns",
      "Schema validation before memory storage",
    ],
    patterns: [
      "Capture feedback immediately with rich context",
      "Enforce schema validation before memory storage",
      "Reject vague signals from memory promotion",
      "Regenerate prevention rules from accumulated mistakes",
    ],
    data_points: [
      "78% reduction in repeated failures after prevention rule enforcement",
      "94% of memory retrieval requests include complete 4-field scope",
    ],
  },
};

// Generate content for a specific platform
function generateContent(themeId, platform, pieceIndex) {
  const theme = THEMES[themeId];
  const bank = CONTENT_BANKS[theme.id] || CONTENT_BANKS['cost-router'];
  const day = new Date().getDate();
  
  // Rotate through hooks/facts based on piece index
  const hook = bank.hooks[(day + pieceIndex) % bank.hooks.length];
  const fact = bank.facts[pieceIndex % bank.facts.length];
  const pattern = bank.patterns[pieceIndex % bank.patterns.length];
  const dataPoint = bank.data_points[pieceIndex % bank.data_points.length];

  let content = '';
  const title = `${theme.name}: ${['Pattern', 'Data', 'Framework'][pieceIndex % 3]} #${pieceIndex + 1}`;
  
  // Platform-specific formatting
  switch (platform.format) {
    case 'professional-post': // LinkedIn
      content = `#ThumbGate\n\n${hook}\n\n**Key insight**: ${fact}\n\n**Pattern**: ${pattern}\n\n**Data point**: ${dataPoint}\n\n${platform.cta}\n`;
      break;
    case 'thread-starter': // X
      content = `#ThumbGate\n\n${hook}\n\n${fact}\n\n${platform.cta}\n`;
      break;
    case 'community-post': // Skool
      content = `#ThumbGate\n\n## ${theme.name}\n\n${hook}\n\n**Framework**:\n${pattern}\n\n**Data**: ${dataPoint}\n\n${platform.cta}\n`;
      break;
    case 'investor-post': // BiggerPockets
      content = `#ThumbGate\n\n## ${theme.name}: ROI Case Study\n\n${hook}\n\n**The Problem**: ${bank.hooks[0]}\n\n**Solution**: ${pattern}\n\n**ROI**: ${dataPoint}\n\n${platform.cta}\n`;
      break;
    case 'discussion-post': // Reddit
      content = `#ThumbGate\n\nHi folks — sharing a learning from the trenches.\n\n${hook}\n\n**What worked**: ${pattern}\n\n**The data**: ${dataPoint}\n\nCurious what patterns others use for ${theme.name.toLowerCase()}.\n`;
      break;
    case 'founder-post': // ZyVOP
      content = `#ThumbGate\n\n## ${theme.name}: Technical Deep Dive\n\n${hook}\n\n## Implementation\n\n${pattern}\n\n## Metrics\n\n${dataPoint}\n\n${platform.cta}\n`;
      break;
    case 'show-hn': // Hacker News
      content = `Show HN: ${theme.name}\n\n${hook}\n\n**Pattern**: ${pattern}\n\n**Data**: ${dataPoint}\n\n${platform.cta}\n`;
      break;
    case 'bsky-post': // Bluesky
      content = `#ThumbGate\n\n${hook}\n\n${fact}\n\n${platform.cta}\n`;
      break;
    case 'threads-post': // Threads
      content = `#ThumbGate\n\n${hook}\n\n${dataPoint}\n\n${platform.cta}\n`;
      break;
    case 'technical-article': // Dev.to
      content = `#ThumbGate\n\n## ${theme.name}\n\n${hook}\n\n### Pattern\n\n${pattern}\n\n### Data\n\n${dataPoint}\n\n### Implementation\n\nCode examples in Node.js. Works with ThumbGate v1.38+.\n\n${platform.cta}\n`;
      break;
    default:
      content = `#ThumbGate\n\n${hook}\n\n${fact}\n\n${platform.cta}\n`;
  }
  
  return { title, content };
}

// Generate 30 pieces (3 per platform × 10 platforms)
function generateToday() {
  const results = [];
  const todayTheme = THEMES[new Date().getDate() % THEMES.length];
  
  for (const platform of PLATFORMS) {
    for (let i = 0; i < 3; i++) {
      // Rotate themes across pieces
      const themeIndex = (THEMES.indexOf(todayTheme) + i) % THEMES.length;
      const { title, content } = generateContent(themeIndex, platform, i);
      
      const fileName = `${DATE_STR}-${platform.id}-monetize-thumbgate-${i + 1}.md`;
      const filePath = path.join(DRAFTS_DIR, fileName);
      
      const fullContent = `---
title: ${title}
platform: ${platform.name} (${platform.format})
theme: ${THEMES[themeIndex].name}
generated: ${DATE_STR}
status: DRAFT
---

${content}`;
      
      fs.writeFileSync(filePath, fullContent);
      results.push({ fileName, platform: platform.name, title });
    }
  }
  
  return results;
}

// Run
const results = generateToday();
console.log(`✓ Generated ${results.length} daily content drafts`);
results.forEach(r => console.log(`  ${r.platform}: ${r.fileName}`));
console.log(`All drafts written to: ${DRAFTS_DIR}`);
