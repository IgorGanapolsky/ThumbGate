#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { registerPreventionRules } = require('./contextfs');
const SKILL_PACKS_DIR = path.join(__dirname, '..', 'config', 'skill-packs');
const BUILTIN_PACKS = {
  'stripe-integration': { name: 'stripe-integration', description: 'Stripe API best practices', triggers: ['stripe', 'payment', 'checkout', 'subscription', 'webhook signature'], rules: ['ALWAYS use idempotency keys on PaymentIntent creation to prevent duplicate charges.', 'NEVER log or store raw card numbers — use Stripe tokens or PaymentMethod IDs.', 'ALWAYS verify webhook signatures with stripe.webhooks.constructEvent() before processing.', 'Use Checkout Sessions instead of raw PaymentIntents for new integrations.', 'ALWAYS handle payment_intent.succeeded AND payment_intent.payment_failed webhooks.'], packTemplate: { namespaces: ['memoryError', 'memoryLearning', 'rules'], maxItems: 8, maxChars: 6000, queryPrefix: 'stripe payment checkout webhook idempotency' } },
  'railway-deploy': { name: 'railway-deploy', description: 'Railway deployment best practices', triggers: ['railway', 'deploy', 'dockerfile', 'health check'], rules: ['ALWAYS verify /health endpoint returns new version after deploy.', 'NEVER say "deployed" without curling the health endpoint and showing version match.', 'ALWAYS check Railway build logs for warnings even when deploy succeeds.', 'Use RAILWAY_VOLUME_MOUNT_PATH for persistent data.', 'ALWAYS wait 2-5 minutes after merge before verifying.'], packTemplate: { namespaces: ['memoryError', 'memoryLearning', 'rules'], maxItems: 8, maxChars: 6000, queryPrefix: 'railway deploy health version dockerfile' } },
  'database-migration': { name: 'database-migration', description: 'Database migration best practices', triggers: ['migration', 'prisma', 'sqlite', 'schema', 'alter table'], rules: ['ALWAYS back up the database before running destructive migrations.', 'NEVER drop columns in production without verifying no code references them.', 'ALWAYS run migrations against a test database first.', 'Use reversible migrations — every up() should have a corresponding down().', 'ALWAYS check for pending migrations before deploying new code.'], packTemplate: { namespaces: ['memoryError', 'rules'], maxItems: 6, maxChars: 5000, queryPrefix: 'migration database schema prisma sqlite' } },
};
const registry = new Map(); for (const [id, p] of Object.entries(BUILTIN_PACKS)) registry.set(id, p);
function ensurePacksDir() { if (!fs.existsSync(SKILL_PACKS_DIR)) fs.mkdirSync(SKILL_PACKS_DIR, { recursive: true }); }
function registerSkillPack(pack) { if (!pack.name) throw new Error('Skill pack requires a name'); if (!Array.isArray(pack.rules) || pack.rules.length === 0) throw new Error('Skill pack requires at least one rule'); const n = { name: pack.name, description: pack.description || '', triggers: Array.isArray(pack.triggers) ? pack.triggers : [], rules: pack.rules, packTemplate: pack.packTemplate || null, registeredAt: new Date().toISOString() }; registry.set(n.name, n); ensurePacksDir(); fs.writeFileSync(path.join(SKILL_PACKS_DIR, `${n.name}.json`), JSON.stringify(n, null, 2) + '\n'); return n; }
function loadSkillPacksFromDisk() { ensurePacksDir(); for (const f of fs.readdirSync(SKILL_PACKS_DIR).filter((x) => x.endsWith('.json'))) { try { const p = JSON.parse(fs.readFileSync(path.join(SKILL_PACKS_DIR, f), 'utf-8')); if (p.name) registry.set(p.name, p); } catch { /* skip */ } } }
function listSkillPacks() { loadSkillPacksFromDisk(); return Array.from(registry.values()).map((p) => ({ name: p.name, description: p.description, triggers: p.triggers, ruleCount: p.rules.length, hasPackTemplate: !!p.packTemplate })); }
function getSkillPack(name) { loadSkillPacksFromDisk(); return registry.get(name) || null; }
function matchSkillPacks(query) { const tokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean); if (tokens.length === 0) return []; loadSkillPacksFromDisk(); const scored = []; for (const pack of registry.values()) { let score = 0; for (const trigger of pack.triggers) { for (const t of trigger.toLowerCase().split(/\s+/)) { if (tokens.some((qt) => qt.includes(t) || t.includes(qt))) score += 1; } } if (score > 0) scored.push({ pack, score }); } return scored.sort((a, b) => b.score - a.score).map((s) => s.pack); }
function installSkillPackRules(name) { const pack = getSkillPack(name); if (!pack) throw new Error(`Skill pack not found: "${name}"`); return registerPreventionRules([`# Skill Pack: ${pack.name}`, '', pack.description || '', '', ...pack.rules.map((r, i) => `${i + 1}. ${r}`)].join('\n'), { skillPack: pack.name }); }
// ---------------------------------------------------------------------------
// L3 Resource Loading (ADK progressive disclosure)
// ---------------------------------------------------------------------------

const RESOURCES_DIR_NAME = 'references';

/**
 * Load an L3 resource file for a skill pack.
 * Resources live in config/skill-packs/{pack-name}/references/{filename}.
 */
function loadSkillResource(packName, resourceName) {
  const resDir = path.join(SKILL_PACKS_DIR, packName, RESOURCES_DIR_NAME);
  const resPath = path.join(resDir, resourceName);
  if (!fs.existsSync(resPath)) return null;
  return { name: resourceName, path: resPath, content: fs.readFileSync(resPath, 'utf-8'), sizeBytes: fs.statSync(resPath).size };
}

/**
 * List available L3 resources for a skill pack.
 */
function listSkillResources(packName) {
  const resDir = path.join(SKILL_PACKS_DIR, packName, RESOURCES_DIR_NAME);
  if (!fs.existsSync(resDir)) return [];
  return fs.readdirSync(resDir).filter((f) => !f.startsWith('.')).map((f) => {
    const fp = path.join(resDir, f);
    return { name: f, sizeBytes: fs.statSync(fp).size };
  });
}

/**
 * Add an L3 resource file to a skill pack.
 */
function addSkillResource(packName, resourceName, content) {
  const resDir = path.join(SKILL_PACKS_DIR, packName, RESOURCES_DIR_NAME);
  ensurePacksDir();
  if (!fs.existsSync(resDir)) fs.mkdirSync(resDir, { recursive: true });
  const resPath = path.join(resDir, resourceName);
  fs.writeFileSync(resPath, content);
  return { name: resourceName, path: resPath, sizeBytes: Buffer.byteLength(content) };
}

// ---------------------------------------------------------------------------
// Skill Factory — agent-driven skill generation
// ---------------------------------------------------------------------------

/**
 * Auto-generate a skill pack from recurring failure patterns.
 * Uses distilled lessons to propose rules for a new domain.
 *
 * @param {Object} opts
 * @param {string} opts.domain - Domain name (e.g., 'graphql-api')
 * @param {Array} opts.lessons - Array of lesson strings from history distiller
 * @param {string} [opts.description] - Pack description
 * @param {Array} [opts.triggers] - Trigger keywords
 * @returns {Object} The created skill pack
 */
function generateSkillPack({ domain, lessons, description, triggers } = {}) {
  if (!domain) throw new Error('Skill factory requires a domain name');
  if (!Array.isArray(lessons) || lessons.length === 0) throw new Error('Skill factory requires at least one lesson');

  // Convert lessons into NEVER/ALWAYS rules
  const rules = lessons.map((lesson) => {
    const l = String(lesson).trim();
    if (/^(NEVER|ALWAYS|DO NOT|MUST)/i.test(l)) return l;
    if (/fail|error|broke|wrong|bug|crash/i.test(l)) return `NEVER ${l.replace(/^(avoid|don'?t|stop)\s*/i, '').trim()}`;
    return `ALWAYS ${l.replace(/^(repeat|keep|continue)\s*/i, '').trim()}`;
  });

  // Infer triggers from domain + lesson content
  const inferredTriggers = triggers || [domain, ...domain.split('-').filter((t) => t.length > 2)];

  return registerSkillPack({
    name: domain,
    description: description || `Auto-generated skill pack for ${domain} from ${lessons.length} lessons`,
    triggers: inferredTriggers,
    rules,
    packTemplate: { namespaces: ['memoryError', 'memoryLearning', 'rules'], maxItems: 8, maxChars: 6000, queryPrefix: inferredTriggers.join(' ') },
  });
}

// ---------------------------------------------------------------------------
// Token-Efficient Progressive Disclosure Metrics
// ---------------------------------------------------------------------------

/**
 * Measure token cost of each disclosure level for a skill pack.
 * Helps agents decide which packs to load.
 */
function measureSkillTokens(packName) {
  const pack = getSkillPack(packName);
  if (!pack) return null;

  // L1: metadata only (~name + description + triggers)
  const l1Text = `${pack.name}: ${pack.description} [${(pack.triggers || []).join(', ')}]`;
  const l1Chars = l1Text.length;

  // L2: full rules
  const l2Text = pack.rules.join('\n');
  const l2Chars = l2Text.length;

  // L3: resources
  const resources = listSkillResources(packName);
  const l3Chars = resources.reduce((sum, r) => sum + r.sizeBytes, 0);

  const totalChars = l1Chars + l2Chars + l3Chars;

  return {
    packName,
    l1: { chars: l1Chars, estimatedTokens: Math.ceil(l1Chars / 4) },
    l2: { chars: l2Chars, estimatedTokens: Math.ceil(l2Chars / 4), ruleCount: pack.rules.length },
    l3: { chars: l3Chars, estimatedTokens: Math.ceil(l3Chars / 4), resourceCount: resources.length },
    total: { chars: totalChars, estimatedTokens: Math.ceil(totalChars / 4) },
    disclosureSavings: totalChars > 0 ? Math.round((1 - l1Chars / totalChars) * 100) : 0,
  };
}

module.exports = { BUILTIN_PACKS, registerSkillPack, listSkillPacks, getSkillPack, matchSkillPacks, installSkillPackRules, SKILL_PACKS_DIR, loadSkillResource, listSkillResources, addSkillResource, generateSkillPack, measureSkillTokens };
