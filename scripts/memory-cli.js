'use strict'

/**
 * Memory Tier CLI — LangChain "memory scoped globally and/or at user level" steal.
 *
 * Exposes ThumbGate's lesson database as a "company memory" that agents
 * can read from two tiers: global (team-wide) and user (individual).
 *
 * Stolen from: Harrison Chase's "company harness" blog
 */

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const MEMORIES_DIR = path.join(__dirname, '..', '.claude', 'memory', 'feedback');

function getMemories(scope = 'all') {
  if (!fs.existsSync(MEMORIES_DIR)) return [];

  const files = fs.readdirSync(MEMORIES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(MEMORIES_DIR, f), 'utf-8')));

  if (scope === 'all') return files;
  return files.filter((m) => {
    if (scope === 'global') return !m.userId || m.scope === 'global';
    if (scope === 'user') return m.userId;
    return true;
  });
}

function search(query) {
  const memories = getMemories();
  const lower = query.toLowerCase();
  return memories.filter((m) => {
    const content = JSON.stringify(m).toLowerCase();
    return content.includes(lower);
  });
}

function main() {
  const args = process.argv.slice(2);
  const action = args[0] || 'list';

  switch (action) {
    case 'list': {
      const scope = args[1] || 'all';
      const memories = getMemories(scope);
      console.log(`# Memory Tier: ${scope}`);
      console.log(`Total: ${memories.length}`);
      for (const m of memories.slice(0, 20)) {
        const scopeLabel = m.scope || 'global';
        const votes = m.votes ? `${m.votes.up || 0}↑ ${m.votes.down || 0}↓` : '';
        console.log(`  [${scopeLabel}] ${m.id || m.feedback?.slice(0, 50) || m.context?.slice(0, 50)} ${votes}`);
      }
      if (memories.length > 20) {
        console.log(`  ... and ${memories.length - 20} more`);
      }
      break;
    }
    case 'search': {
      const query = args.slice(1).join(' ');
      if (!query) {
        console.log('Usage: memory search "query"');
        break;
      }
      const results = search(query);
      console.log(`# Search: "${query}"`);
      console.log(`Results: ${results.length}`);
      for (const r of results.slice(0, 10)) {
        console.log(`  [${r.scope || 'global'}] ${r.feedback || r.context || ''}`);
      }
      break;
    }
    case 'stats': {
      const memories = getMemories();
      const global = memories.filter((m) => !m.userId).length;
      const userScoped = memories.filter((m) => m.userId).length;
      const blocked = memories.filter((m) => m.status === 'rule_created').length;
      const active = memories.filter((m) => m.status === 'active').length;
      console.log(`# Memory Stats`);
      console.log(`  Global memories: ${global}`);
      console.log(`  User-scoped memories: ${userScoped}`);
      console.log(`  Active prevention rules: ${blocked}`);
      console.log(`  Pending review: ${active}`);
      break;
    }
    default:
      console.log('Usage: memory <list|search|stats> [scope/query]');
      console.log('  list [all|global|user]  — list memories in tier');
      console.log('  search "query"          — search memories');
      console.log('  stats                   — show memory tier stats');
  }
}

if (require.main === module) {
  main();
}

module.exports = { getMemories, search };
