'use strict';

// Every tool the MCP server ADVERTISES must be one the MCP server can ACTUALLY
// RUN. Nothing enforced that before: three tools (schedule, user_profile,
// webhook_deliver) shipped in the registry with no case in the dispatcher, so a
// client saw them in tools/list, called one, and got
// `Unsupported tool: <name>` from the default branch of the switch.
//
// That is worse than a mislabelled annotation. A wrong hint makes a real
// capability look risky; a phantom declaration makes a capability that does not
// exist look available, and the client only finds out mid-task.
//
// Found 2026-08-06 by reading every handler rather than trusting tool names —
// the same audit disproved three "obvious" mislabels that turned out to write
// files. Name shape is not evidence; the dispatcher is.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DISPATCHER = path.join(ROOT, 'adapters', 'mcp', 'server-stdio.js');
const registry = require(path.join(ROOT, 'scripts', 'tool-registry.js'));

function declaredTools() {
  const raw = registry.TOOLS || registry.tools || (registry.getTools && registry.getTools()) || registry.default || [];
  const list = Array.isArray(raw)
    ? raw
    : Object.values(raw).flat().filter((t) => t && t.name);
  return list.map((t) => t.name);
}

// The dispatcher is a switch over tool names. Cases may be stacked
// (`case 'a': case 'b': return ...`), so collect every case label.
function dispatchableNames(source) {
  return new Set([...source.matchAll(/case\s+'([a-z0-9_]+)'\s*:/gi)].map((m) => m[1]));
}

// Some names are remapped to another tool before the switch, e.g.
// `if (name === 'get_reliability_rules') name = 'prevention_rules';`
function aliasTargets(source) {
  const map = new Map();
  for (const m of source.matchAll(/name\s*===\s*'([a-z0-9_]+)'\s*\)\s*name\s*=\s*'([a-z0-9_]+)'/gi)) {
    map.set(m[1], m[2]);
  }
  return map;
}

test('every advertised MCP tool is dispatchable', () => {
  const source = fs.readFileSync(DISPATCHER, 'utf8');
  const cases = dispatchableNames(source);
  const aliases = aliasTargets(source);

  const phantom = declaredTools().filter((name) => {
    const target = aliases.get(name) || name;
    return !cases.has(target);
  });

  assert.deepEqual(
    phantom,
    [],
    `these tools are advertised over MCP but hit the dispatcher's default throw: ${phantom.join(', ')}`,
  );
});

test('the dispatcher still fails loudly on a genuinely unknown tool', () => {
  // The parity test above must not be satisfiable by deleting the default
  // branch — an unknown name has to keep erroring rather than silently no-op.
  const source = fs.readFileSync(DISPATCHER, 'utf8');
  assert.match(source, /Unsupported tool/, 'dispatcher must retain its unknown-tool guard');
});

test('alias targets resolve to real dispatcher cases', () => {
  const source = fs.readFileSync(DISPATCHER, 'utf8');
  const cases = dispatchableNames(source);
  for (const [alias, target] of aliasTargets(source)) {
    assert.ok(
      cases.has(target),
      `alias ${alias} remaps to ${target}, which has no dispatcher case`,
    );
  }
});
