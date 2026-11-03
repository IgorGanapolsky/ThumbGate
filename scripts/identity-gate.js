'use strict'

/**
 * Identity-Aware Gates — LangChain "knows who's asking" steal.
 *
 * When an agent action is blocked, ThumbGate now surfaces WHO the
 * prevention rule applies to (global, per-user, per-project).
 * Mirrors LangChain's OBO vs fixed-credential identity model.
 *
 * Stolen from: Harrison Chase's "The five components of building a company harness"
 */

const fs = require('node:fs');
const path = require('node:path');

const MEMORY_DIR = path.join(__dirname, '..', '.claude', 'memory', 'feedback');

/**
 * Get the identity context for the current session.
 * Falls back to env vars if no explicit identity.
 */
function getIdentityContext() {
  return {
    userId: process.env.THUMBGATE_USER || process.env.USER || 'anonymous',
    sessionId: process.env.THUMBGATE_SESSION || `session_${Date.now()}`,
    project: process.env.THUMBGATE_PROJECT || path.basename(process.cwd()),
  };
}

/**
 * Find rules that apply to the given identity scope.
 * Global rules always apply. User/project rules only apply to matching scopes.
 */
function getScopedRules(identity) {
  if (!fs.existsSync(MEMORY_DIR)) return [];

  const rules = [];
  const files = fs.readdirSync(MEMORY_DIR).filter(
    (f) => f.startsWith('rule_') && f.endsWith('.json')
  );

  for (const file of files) {
    const rule = JSON.parse(fs.readFileSync(path.join(MEMORY_DIR, file), 'utf-8'));

    // Global rules always apply
    if (rule.scope === 'global' || !rule.scope) {
      rules.push(rule);
      continue;
    }

    // User-scoped rules
    if (rule.scope === 'user' && rule.userId === identity.userId) {
      rules.push(rule);
      continue;
    }

    // Project-scoped rules
    if (rule.scope === 'project' && rule.project === identity.project) {
      rules.push(rule);
      continue;
    }
  }

  return rules;
}

/**
 * Before an agent action, check both global + identity-scoped rules.
 * Returns { allowed: boolean, blockedBy: [...], warnings: [...] }
 */
function checkIdentityScopedAction(action, identity = null) {
  const ctx = identity || getIdentityContext();
  const rules = getScopedRules(ctx);

  const blocked = [];
  const warnings = [];

  for (const rule of rules) {
    if (rule.pattern && new RegExp(rule.pattern).test(action)) {
      if (rule.severity === 'BLOCK') {
        blocked.push({
          ruleId: rule.id,
          reason: rule.reason,
          scope: rule.scope || 'global',
          source: rule.source,
          confidence: rule.confidence,
        });
      } else if (rule.severity === 'WARN') {
        warnings.push({
          ruleId: rule.id,
          reason: rule.reason,
          scope: rule.scope || 'global',
        });
      }
    }
  }

  return {
    allowed: blocked.length === 0,
    blockedBy: blocked,
    warnings,
    identity: ctx,
  };
}

function main() {
  const args = process.argv.slice(2);
  const action = args.join(' ');

  const identity = getIdentityContext();
  console.log(`# Identity-Scoped Gate Check`);
  console.log(`User: ${identity.userId}`);
  console.log(`Session: ${identity.sessionId}`);
  console.log(`Project: ${identity.project}`);

  const result = checkIdentityScopedAction(action, identity);
  console.log(`\nAction: ${action || '(none)'}`);
  console.log(`Allowed: ${result.allowed}`);

  if (result.blockedBy.length > 0) {
    console.log(`\nBlocked by ${result.blockedBy.length} rule(s):`);
    for (const b of result.blockedBy) {
      console.log(`  ❌ [${b.scope}] ${b.reason} (source: ${b.source}, conf: ${b.confidence})`);
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  getIdentityContext,
  getScopedRules,
  checkIdentityScopedAction,
};
