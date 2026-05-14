const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Pin the model-agnostic positioning claim with executable evidence.
//
// ThumbGate's docstring promises that train_from_feedback.py and
// feedback_quality_eval.py classify feedback emitted by ANY adapter —
// Claude Code, Cursor, Codex, Gemini, Cline, Amp, OpenCode. The eight
// fixtures below describe the SAME tool call (an Edit on src/foo.ts)
// in the canonical schema each adapter actually writes. classify_entry
// must return the same category ("code_edit") for all of them.
//
// Why this test exists: prior to the shared feedback_categories.py
// module, the trainer read field name `last_action` (snake_case) while
// the canonical capture-feedback.js writer emitted `lastAction` (camel),
// which silently dropped tool-name signal on real data. Add an adapter
// shape to ADAPTER_FIXTURES whenever a new adapter starts emitting
// feedback so we never silently regress that contract again.

const SCRIPT = path.join(__dirname, '..', 'scripts', 'feedback_categories.py');

const ADAPTER_FIXTURES = {
  // Canonical capture-feedback.js shape — what .thumbgate/feedback-log.jsonl
  // actually contains (camelCase, includes lastAction not last_action).
  thumbgate_canonical: {
    id: 'fb_canonical',
    signal: 'positive',
    context: 'Edit src/foo.ts',
    submittedContext: 'Edit src/foo.ts',
    lastAction: 'Edit',
    tags: ['edit'],
    timestamp: '2026-05-14T00:00:00Z',
  },
  // Legacy trainer shape — pre-camelCase migration entries still on disk
  // from older ThumbGate installs.
  legacy_trainer: {
    signal: 'positive',
    context: 'edited a file',
    last_tool: 'Edit',
    last_action: 'edit',
    tags: [],
    timestamp: '2026-05-14T00:00:00Z',
  },
  // Cursor MCP — emits toolName per Cursor MCP convention.
  cursor: {
    signal: 'up',
    context: 'cursor edit applied',
    toolName: 'Edit',
    tags: ['edit'],
    timestamp: '2026-05-14T00:00:00Z',
  },
  // Codex CLI — emits tool_name (snake_case) per Codex config.toml schema.
  codex: {
    signal: 'positive',
    context: 'codex applied edit',
    tool_name: 'Edit',
    tags: [],
    timestamp: '2026-05-14T00:00:00Z',
  },
  // Gemini function-declarations.json shape — capture_memory_feedback args.
  gemini: {
    signal: 'up',
    context: 'gemini implemented change',
    tags: ['edit'],
    timestamp: '2026-05-14T00:00:00Z',
  },
  // Cline — IDE extension; uses lastAction (camelCase) like canonical.
  cline: {
    signal: 'positive',
    context: 'cline write_to_file',
    lastAction: 'write',
    tags: [],
    timestamp: '2026-05-14T00:00:00Z',
  },
  // Amp skill — markdown skill emits feedback (legacy alias for signal).
  amp: {
    feedback: 'up',
    context: 'amp refactor pass',
    tags: ['edit'],
    timestamp: '2026-05-14T00:00:00Z',
  },
  // OpenCode — uses signal + context only, no tool field.
  opencode: {
    signal: 'positive',
    context: 'opencode update file',
    tags: [],
    timestamp: '2026-05-14T00:00:00Z',
  },
};

function classifyAcrossAdapters(fixtures) {
  const probe = `
import json
import sys
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(path.dirname(SCRIPT))})
from feedback_categories import classify_entry, normalize_signal

fixtures = json.loads(${JSON.stringify(JSON.stringify(fixtures))})
result = {
    name: {
        'categories': classify_entry(entry),
        'signal': normalize_signal(entry),
    }
    for name, entry in fixtures.items()
}
print(json.dumps(result))
`;
  const proc = spawnSync('python3', ['-c', probe], { encoding: 'utf8' });
  if (proc.status !== 0) {
    throw new Error(`probe failed: ${proc.stderr || proc.stdout}`);
  }
  return JSON.parse(proc.stdout.trim());
}

test('classify_entry returns code_edit for an Edit tool call across every adapter shape', () => {
  const result = classifyAcrossAdapters(ADAPTER_FIXTURES);
  for (const [adapter, { categories }] of Object.entries(result)) {
    assert.ok(
      categories.includes('code_edit'),
      `${adapter}: expected code_edit in categories, got ${JSON.stringify(categories)}`,
    );
    assert.ok(
      !categories.includes('uncategorized'),
      `${adapter}: classify_entry fell back to uncategorized — adapter shape is not recognized`,
    );
  }
});

test('normalize_signal returns positive for every adapter sentiment alias', () => {
  const result = classifyAcrossAdapters(ADAPTER_FIXTURES);
  for (const [adapter, { signal }] of Object.entries(result)) {
    assert.equal(
      signal,
      'positive',
      `${adapter}: normalize_signal returned ${signal}, expected positive`,
    );
  }
});

test('classify_entry uses regex word boundaries (no false positive on substring overlap)', () => {
  // Pre-fix bug: the trainer used naive `kw in searchable` substring
  // matching, so 'edit' would falsely match 'credit', 'test' would match
  // 'latest', and 'merge' would match 'emerged'. The shared module uses
  // regex word boundaries — pin that contract so the regression cannot
  // sneak back in.
  const traps = {
    credit_not_edit: {
      signal: 'positive',
      context: 'reviewed credit card billing flow',
      tags: [],
      timestamp: '2026-05-14T00:00:00Z',
    },
    latest_not_test: {
      signal: 'positive',
      context: 'fetched the latest deploy version',
      tags: [],
      timestamp: '2026-05-14T00:00:00Z',
    },
    emerged_not_merge: {
      signal: 'positive',
      context: 'a pattern emerged from the metrics',
      tags: [],
      timestamp: '2026-05-14T00:00:00Z',
    },
  };
  const result = classifyAcrossAdapters(traps);
  assert.ok(
    !result.credit_not_edit.categories.includes('code_edit'),
    `'credit' must NOT match the 'edit' keyword — got ${JSON.stringify(result.credit_not_edit.categories)}`,
  );
  assert.ok(
    !result.latest_not_test.categories.includes('testing'),
    `'latest' must NOT match the 'test' keyword — got ${JSON.stringify(result.latest_not_test.categories)}`,
  );
  assert.ok(
    !result.emerged_not_merge.categories.includes('git'),
    `'emerged' must NOT match the 'merge' keyword — got ${JSON.stringify(result.emerged_not_merge.categories)}`,
  );
});
