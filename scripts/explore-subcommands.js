#!/usr/bin/env node
'use strict';

/**
 * explore-subcommands.js — non-interactive explore for agent consumption.
 *
 * Supports:
 *   thumbgate explore lessons [--json] [--limit=N]
 *   thumbgate explore rules   [--json]
 *   thumbgate explore gates   [--json]
 *
 * When --json is passed, outputs structured data. Otherwise renders
 * human-readable tables with context signal badges.
 */

const fs = require('fs');
const path = require('path');

const BD = '\x1b[1m';
const RST = '\x1b[0m';
const G = '\x1b[32m';
const R = '\x1b[31m';
const C = '\x1b[36m';
const Y = '\x1b[33m';
const D = '\x1b[90m';

function relDate(ts) {
  if (!ts) return '';
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  if (d === 0) return 'today';
  if (d === 1) return '1d ago';
  return `${d}d ago`;
}

function confidenceBadge(lesson) {
  // Derive confidence from signal + whether it became a gate
  const signal = (lesson.signal || lesson.feedback || '').toLowerCase();
  if (lesson.gatePromoted || lesson.autoGateId) return `${G}[ACTIVE]${RST}`;
  if (signal.includes('negative') || signal === 'down') return `${Y}[LEARNING]${RST}`;
  return `${D}[LEARNING]${RST}`;
}

function scopeBadge() {
  return `${C}[LOCAL]${RST}`;
}

function actionBadge(action) {
  if (action === 'block') return `${R}[BLOCKED]${RST}`;
  if (action === 'warn') return `${Y}[WARN]${RST}`;
  return `${G}[ALLOWED]${RST}`;
}

// ---------------------------------------------------------------------------
// Data loaders (reuse from explore.js patterns)
// ---------------------------------------------------------------------------

function loadLessons(feedbackDir) {
  const p = path.join(feedbackDir, 'memory-log.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean).reverse();
}

function loadGates(pkgRoot) {
  const gatesDir = path.join(pkgRoot, 'config', 'gates');
  const gates = [];
  if (!fs.existsSync(gatesDir)) return gates;
  for (const f of fs.readdirSync(gatesDir).sort()) {
    if (!f.endsWith('.json') || f === 'custom.json') continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(gatesDir, f), 'utf8'));
      const items = Array.isArray(raw) ? raw : (raw.gates || raw.rules || [raw]);
      items.forEach(g => gates.push({ ...g, _file: f }));
    } catch { /* skip */ }
  }
  // Auto-promoted gates
  try {
    const { loadAutoGates } = require(path.join(pkgRoot, 'scripts', 'auto-promote-gates'));
    const auto = loadAutoGates();
    (auto.gates || []).forEach(g => gates.push({ ...g, _file: 'auto-promoted', _auto: true }));
  } catch { /* ok */ }
  return gates;
}

function loadRules(feedbackDir) {
  const p = path.join(feedbackDir, 'prevention-rules.md');
  if (!fs.existsSync(p)) return [];
  const content = fs.readFileSync(p, 'utf8');
  // Split on ## headers; the first segment is the preamble (before any ##), skip it
  const parts = content.split(/^## /m);
  const ruleSections = parts.slice(1).filter(Boolean);
  return ruleSections.map((section, i) => {
    const lines = section.trim().split('\n');
    const title = lines[0] || `Rule ${i + 1}`;
    const body = lines.slice(1).join('\n').trim();
    return { id: i + 1, title: title.trim(), body };
  });
}

function loadGateFirings(feedbackDir) {
  const p = path.join(feedbackDir, 'rejection-ledger.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean).reverse();
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

function exploreLessons(options = {}) {
  const { feedbackDir, limit = 20, json = false } = options;
  const lessons = loadLessons(feedbackDir).slice(0, limit);

  if (json) {
    const payload = lessons.map(l => ({
      id: l.id,
      signal: l.signal || l.feedback,
      context: l.content || l.context || '',
      tags: l.tags || [],
      domain: l.domain || null,
      importance: l.importance || 'medium',
      timestamp: l.timestamp || l.createdAt,
      scope: 'local',
      confidence: (l.gatePromoted || l.autoGateId) ? 'active' : 'learning',
    }));
    return { lessons: payload, total: payload.length, scope: 'local' };
  }

  const lines = [];
  lines.push('');
  lines.push(`${BD}thumbgate explore lessons${RST}  ${scopeBadge()}`);
  lines.push('─'.repeat(60));

  if (lessons.length === 0) {
    lines.push('  No lessons stored yet. Capture feedback to create lessons.');
    lines.push('  Run: npx thumbgate capture --feedback=down --context="what failed"');
  }

  for (const l of lessons) {
    const sig = (l.signal || l.feedback || '').toLowerCase();
    const icon = sig.includes('positive') || sig === 'up' ? `${G}+${RST}` : `${R}-${RST}`;
    const badge = confidenceBadge(l);
    const context = (l.content || l.context || '').slice(0, 70);
    const ts = relDate(l.timestamp || l.createdAt);
    const tags = (l.tags || []).join(', ');
    lines.push(`  ${icon} ${badge} ${context}`);
    if (tags || ts) {
      lines.push(`    ${D}${ts}${tags ? '  tags: ' + tags : ''}${RST}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function exploreRules(options = {}) {
  const { feedbackDir, json = false } = options;
  const rules = loadRules(feedbackDir);

  if (json) {
    const payload = rules.map(r => ({
      id: r.id,
      title: r.title,
      body: r.body,
      scope: 'local',
    }));
    return { rules: payload, total: payload.length, scope: 'local' };
  }

  const lines = [];
  lines.push('');
  lines.push(`${BD}thumbgate explore rules${RST}  ${scopeBadge()}`);
  lines.push('─'.repeat(60));

  if (rules.length === 0) {
    lines.push('  No prevention rules generated yet.');
    lines.push('  Run: npx thumbgate rules');
  }

  for (const r of rules) {
    lines.push(`  ${Y}Rule ${r.id}${RST}: ${r.title}`);
    if (r.body) {
      const preview = r.body.split('\n')[0].slice(0, 80);
      lines.push(`    ${D}${preview}${RST}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function exploreGates(options = {}) {
  const { pkgRoot, json = false } = options;
  const gates = loadGates(pkgRoot || path.join(__dirname, '..'));

  if (json) {
    const payload = gates.map(g => ({
      id: g.id || g.name || 'unnamed',
      pattern: g.pattern || g.toolName || '',
      action: g.action || 'warn',
      occurrences: g.occurrences || 0,
      source: g._auto ? 'auto-promoted' : (g._file || 'manual'),
      scope: 'local',
      status: g.action === 'block' ? 'blocked' : 'allowed',
    }));
    return { gates: payload, total: payload.length, scope: 'local' };
  }

  const lines = [];
  lines.push('');
  lines.push(`${BD}thumbgate explore gates${RST}  ${scopeBadge()}`);
  lines.push('─'.repeat(60));

  if (gates.length === 0) {
    lines.push('  No gates configured. Run: npx thumbgate init');
  }

  for (const g of gates) {
    const name = g.id || g.name || 'unnamed';
    const badge = actionBadge(g.action);
    const source = g._auto ? 'auto' : g._file || 'manual';
    const occ = g.occurrences ? ` (${g.occurrences} fires)` : '';
    lines.push(`  ${badge} ${name}  ${D}${source}${occ}${RST}`);
    if (g.pattern) {
      lines.push(`    ${D}pattern: ${g.pattern}${RST}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function exploreGateFirings(options = {}) {
  const { feedbackDir, limit = 20, json = false } = options;
  const firings = loadGateFirings(feedbackDir).slice(0, limit);

  if (json) {
    const payload = firings.map(f => ({
      id: f.id,
      signal: f.signal,
      context: f.context || '',
      reason: f.reason || '',
      timestamp: f.timestamp,
      scope: 'local',
      result: 'blocked',
    }));
    return { firings: payload, total: payload.length, scope: 'local' };
  }

  const lines = [];
  lines.push('');
  lines.push(`${BD}thumbgate explore firings${RST}  ${scopeBadge()}`);
  lines.push('─'.repeat(60));

  if (firings.length === 0) {
    lines.push('  No gate firings recorded yet.');
  }

  for (const f of firings) {
    const ts = relDate(f.timestamp);
    lines.push(`  ${R}[BLOCKED]${RST} ${(f.context || f.reason || '').slice(0, 60)}`);
    lines.push(`    ${D}${ts}  reason: ${f.reason || 'unknown'}${RST}`);
  }
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  exploreLessons,
  exploreRules,
  exploreGates,
  exploreGateFirings,
  loadLessons,
  loadGates,
  loadRules,
  loadGateFirings,
};
