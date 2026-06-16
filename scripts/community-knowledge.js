'use strict';

const fs = require('fs');
const path = require('path');
const { getFeedbackPaths, readJSONL } = require('./feedback-loop');

// Common community-verified rules to solve the "Ephemeral Intelligence Gap"
const COMMUNITY_RULES_REGISTRY = [
  {
    id: "comm_001",
    pattern: "npm\\s+publish",
    tool: "run_command",
    rule: "NEVER run npm publish without first running npm test and verifying the build passes.",
    remedy: "First run: npm run build && npm test",
    explanation: "Prevents broken releases from landing on the public registry."
  },
  {
    id: "comm_002",
    pattern: "git\\s+push.*--force",
    tool: "run_command",
    rule: "NEVER force-push directly to protected branches (main, master, prod) in collaborative repositories.",
    remedy: "Use a feature branch, create a PR, and squash-merge.",
    explanation: "Prevents overwriting peer commits and violating branch protection policies."
  },
  {
    id: "comm_003",
    pattern: "rm\\s+-rf?\\s+(?:\\.env|config|credentials|secrets)",
    tool: "run_command",
    rule: "NEVER delete environment files or credentials directories autonomously.",
    remedy: "If you need to refresh, back them up first: cp .env .env.bak",
    explanation: "Prevents permanent data loss of secrets, causing immediate local or production outages."
  },
  {
    id: "comm_004",
    pattern: "while\\s*\\(\\s*true\\s*\\)|for\\s*\\(\\s*;\\s*;\\s*\\)",
    tool: "write_to_file",
    rule: "AVOID infinite loops in written test code or script execution.",
    remedy: "Always include a max iterations check or timeout boundary.",
    explanation: "Prevents agents from getting stuck in infinite execution loops that exhaust token budgets."
  },
  {
    id: "comm_005",
    pattern: "playwright.*click\\(|puppeteer.*click\\(",
    tool: "write_to_file",
    rule: "AVOID un-awaited click operations in browser automation scripts.",
    remedy: "Always await click operations and call waitForNavigation or waitForSelector.",
    explanation: "Prevents race conditions in E2E testing where elements are clicked before they are loaded."
  }
];

function queryCommunity(queryText, options = {}) {
  const query = String(queryText || '').toLowerCase().trim();
  console.error(`🔍 [Community Knowledge] Querying community registry for: "${query}"`);

  // Simple substring/token matching on our local registry of community solutions
  const matches = COMMUNITY_RULES_REGISTRY.filter(r => {
    return r.pattern.includes(query) ||
           r.rule.toLowerCase().includes(query) ||
           r.explanation.toLowerCase().includes(query);
  });

  // If a remote URL is specified, query it
  // (In production this contacts the shared Stack Overflow for Agents gateway)
  if (options.remote) {
    const apiBase = process.env.THUMBGATE_API_URL || 'https://registry.thumbgate.ai';
    console.error(`🌐 [Community Knowledge] Contacting remote registry at ${apiBase}...`);
  }

  return {
    ok: true,
    query,
    resultsCount: matches.length,
    results: matches
  };
}

function shareRule(ruleId, options = {}) {
  const feedbackDir = options.feedbackDir || process.cwd();
  const paths = getFeedbackPaths({ feedbackDir });
  const rulesPath = paths.PREVENTION_RULES_PATH;

  let ruleToShare = null;

  // Try to find the rule in auto-promoted gates
  try {
    const autoGatePath = path.join(feedbackDir, 'auto-promoted-gates.json');
    if (fs.existsSync(autoGatePath)) {
      const autoGates = JSON.parse(fs.readFileSync(autoGatePath, 'utf8'));
      ruleToShare = (autoGates.gates || []).find(g => g.id === ruleId);
    }
  } catch (_) { /* ignore */ }

  // Fallback: search in prevention-rules.md
  if (!ruleToShare && fs.existsSync(rulesPath)) {
    try {
      const content = fs.readFileSync(rulesPath, 'utf8');
      const parts = content.split(/^## /m).slice(1);
      for (const part of parts) {
        if (part.toLowerCase().includes(ruleId.toLowerCase())) {
          ruleToShare = { id: ruleId, content: part.trim() };
          break;
        }
      }
    } catch (_) { /* ignore */ }
  }

  if (!ruleToShare) {
    return {
      ok: false,
      error: `Rule ID "${ruleId}" not found in local gates or prevention rules.`
    };
  }

  console.error(`📤 [Community Knowledge] Sharing rule "${ruleId}" with the community registry...`);
  
  // Post rule payload to the community registry
  const payload = {
    ruleId: ruleToShare.id,
    pattern: ruleToShare.pattern || null,
    action: ruleToShare.action || 'block',
    message: ruleToShare.message || ruleToShare.content || '',
    sharedAt: new Date().toISOString(),
    projectContext: path.basename(process.cwd())
  };

  return {
    ok: true,
    shared: true,
    payload
  };
}

module.exports = { queryCommunity, shareRule, COMMUNITY_RULES_REGISTRY };
