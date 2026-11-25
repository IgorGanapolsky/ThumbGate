'use strict';

/**
 * Deploy-proof gate (Stop hook check).
 *
 * Blocks a reply that says "deployed", "shipped", "now live" or "in production"
 * unless the same reply shows proof from production: curl output against the
 * production host, a /health JSON snapshot, a buildSha, an HTTP 200 from the
 * production host, or a configured CI sentinel line such as "Deploy verified".
 *
 * Generalized from the ThumbGate repo's own hook-stop-verify-deploy.sh, which
 * was hardcoded to thumbgate.ai. Every project names its own production hosts:
 *
 *   .thumbgate/deploy-proof.json
 *     { "hosts": ["app.example.com"], "sentinels": ["Deploy verified"] }
 *   or THUMBGATE_PROD_HOSTS="app.example.com,api.example.com"
 *
 * With no hosts configured, curl / HTTP 200 / /health proof against any https
 * host counts. On by default; THUMBGATE_DEPLOY_PROOF_GATE=0 turns it off.
 * It blocks once: Claude Code reruns a blocked Stop hook with
 * stop_hook_active=true, and the caller allows that rerun, so a reply never loops.
 */

const fs = require('node:fs');
const path = require('node:path');

const CLAIM_SOURCE = String.raw`\b(deployed|shipped|live (?:in|to|on) production|live at|now live|is live\b|in prod\b|in production\b|verified in (?:prod|production))\b`;
const NEGATION_BEFORE = /\b(?:not|never|before|until|once|if|when|after|yet to be)\b(?:\s+\S+){0,2}\s*$/i;
const NEGATION_AFTER = /^[\s,.:;?]*\b(?:no|not|yet\?)\b/i;
// Hypothetical or instructional mentions, not a claim that it happened.
const HEDGE_IN_CLAUSE = /\b(?:will be|would be|should be|to be|can be|could be|might be|once it(?:'s| is)|after it(?:'s| is)|before it(?:'s| is)|if it(?:'s| is))\s+(?:\w+\s+)?(?:deployed|shipped|live)\b/i;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function loadDeployProofConfig(options = {}) {
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const config = { hosts: [], sentinels: [] };
  const configPath = options.configPath
    || env.THUMBGATE_DEPLOY_PROOF_CONFIG
    || path.join(cwd, '.thumbgate', 'deploy-proof.json');
  try {
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (Array.isArray(parsed.hosts)) config.hosts.push(...parsed.hosts);
      if (Array.isArray(parsed.sentinels)) config.sentinels.push(...parsed.sentinels);
      if (parsed.enabled === false) config.enabled = false;
    }
  } catch {
    // A broken config must not crash the agent; fall back to generic proof.
  }
  if (env.THUMBGATE_PROD_HOSTS) {
    config.hosts.push(...String(env.THUMBGATE_PROD_HOSTS).split(','));
  }
  config.hosts = [...new Set(config.hosts.map((h) => String(h).trim().toLowerCase()).filter(Boolean))];
  config.sentinels = [...new Set(config.sentinels.map((s) => String(s).trim()).filter(Boolean))];
  return config;
}

function clauseAround(text, index, length) {
  let start = index;
  let end = index + length;
  const isBoundary = (ch) => /[.!?;\n]/.test(ch);
  while (start > 0 && !isBoundary(text[start - 1])) start -= 1;
  while (end < text.length && !isBoundary(text[end])) end += 1;
  return { clause: text.slice(start, end), terminator: text[end] || '' };
}

/** Returns the first un-negated deploy claim in the text, or null. */
function findDeployClaim(text) {
  const response = String(text || '');
  const re = new RegExp(CLAIM_SOURCE, 'gi');
  let match;
  while ((match = re.exec(response)) !== null) {
    const before = response.slice(Math.max(0, match.index - 30), match.index);
    const after = response.slice(match.index + match[0].length, match.index + match[0].length + 15);
    const { clause, terminator } = clauseAround(response, match.index, match[0].length);
    if (NEGATION_BEFORE.test(before) || NEGATION_AFTER.test(after)) continue;
    if (NON_PROD_TARGET.test(response.slice(match.index + match[0].length, match.index + match[0].length + 40))) continue;
    if (HEDGE_IN_CLAUSE.test(clause)) continue;
    if (terminator === '?') continue; // a question, not a claim
    return match[0];
  }
  return null;
}

// A check that ran and failed is not proof.
const FAILURE_RE = /\b(?:connection refused|could not resolve|timed? ?out|failed to connect|bad gateway|service unavailable|ECONNREFUSED|ENOTFOUND|ETIMEDOUT)\b|\bHTTP[\s/]*(?:1\.[01]|2(?:\.0)?)?\s*[45]\d\d\b|"(?:status)"\s*:\s*"(?:error|down|fail(?:ed|ing)?|unhealthy|degraded)"|"ok"\s*:\s*false/i;
// Explicitly non-production targets.
const NON_PROD_TARGET = /^\s*(?:to|on|in|at)\s+(?:the\s+)?(?:staging|stage|dev|development|preview|test|testing|qa|sandbox|local(?:host)?)\b/i;

/**
 * Returns the kinds of production proof found in the text. A curl command on
 * its own is not proof: the reply must show a result (health JSON, buildSha,
 * HTTP 200 or a sentinel line), and any reported failure cancels the proof.
 * With hosts configured, the result must sit next to a configured host.
 */
function findDeployEvidence(text, config = { hosts: [], sentinels: [] }) {
  const response = String(text || '');
  if (FAILURE_RE.test(response)) return [];
  const hosts = config.hosts || [];
  const hostRe = hosts.length
    ? new RegExp(`(?:${hosts.map(escapeRegExp).join('|')})`, 'i')
    : /https?:\/\/[a-z0-9.-]+\.[a-z]{2,}|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/i;
  const hostSeen = hostRe.test(response);
  const found = [];

  if (/"buildSha"\s*:\s*"[a-f0-9]{6,}/i.test(response) || /\bbuildSha\s*[:=]\s*[a-f0-9]{6,}/i.test(response)) {
    found.push('buildSha');
  }
  if (/\{[^{}]*"(?:status|ok)"\s*:\s*(?:"ok"|"healthy"|true)[^{}]*\}/i.test(response)
    || /\{[^{}]*"version"\s*:\s*"\d+\.\d+\.\d+[^"]*"[^{}]*\}/i.test(response)) {
    found.push('health-json');
  }
  if (/\bHTTP[\s/]*(?:1\.[01]|2(?:\.0)?)?\s*200\b/i.test(response)) {
    found.push('http-200');
  }
  // Results only count when the production host is named in the same reply.
  const results = hostSeen ? found : [];
  for (const sentinel of config.sentinels || []) {
    if (response.includes(sentinel)) {
      results.push(`sentinel:${sentinel}`);
      break;
    }
  }
  return results;
}

function deployProofReason(claim, config) {
  const where = config.hosts.length ? config.hosts.join(', ') : 'the production host';
  const sentinel = config.sentinels.length ? `, or the "${config.sentinels[0]}" CI line` : '';
  return `ThumbGate deploy-proof gate: this reply says "${claim}" but shows no proof from production. `
    + `Run the check now and paste its output in the same reply: curl output from ${where}, a /health JSON snapshot, `
    + `a buildSha, an HTTP 200${sentinel}. If you can't check, say "not verified" instead of claiming it.`;
}

/**
 * Evaluate a reply. Returns a Stop-hook block object, or null to allow.
 */
function evaluateDeployProof(text, options = {}) {
  const env = options.env || process.env;
  if (env.THUMBGATE_DEPLOY_PROOF_GATE === '0') return null;
  const config = options.config || loadDeployProofConfig(options);
  if (config.enabled === false) return null;
  const claim = findDeployClaim(text);
  if (!claim) return null;
  const evidence = findDeployEvidence(text, config);
  if (evidence.length) return null;
  return {
    decision: 'block',
    reason: deployProofReason(claim, config),
    gate: 'deploy-proof',
  };
}

module.exports = {
  evaluateDeployProof,
  findDeployClaim,
  findDeployEvidence,
  loadDeployProofConfig,
};
