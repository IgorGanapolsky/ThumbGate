#!/usr/bin/env node
'use strict';

const {
  deriveContextKey,
  getReliability,
  buildWarning,
  WEAK_ARM_THRESHOLD,
} = require('../hooks/claude-code/pretool-inject');

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}`);
  }
}

// ---------------------------------------------------------------------------
// deriveContextKey
// ---------------------------------------------------------------------------

console.log('\nderiveContextKey:');

assert(
  deriveContextKey('Bash', { command: 'git push origin main' }) === 'Bash:git_push',
  'git push → Bash:git_push',
);

assert(
  deriveContextKey('Bash', { command: 'git commit -m "test"' }) === 'Bash:git_commit',
  'git commit → Bash:git_commit',
);

assert(
  deriveContextKey('Bash', { command: 'npm test' }) === 'Bash:npm_test',
  'npm test → Bash:npm_test',
);

assert(
  deriveContextKey('Bash', { command: 'npm run lint' }) === 'Bash:npm_run',
  'npm run → Bash:npm_run',
);

assert(
  deriveContextKey('Bash', { command: 'rm -rf /tmp/old' }) === 'Bash:destructive',
  'rm → Bash:destructive',
);

assert(
  deriveContextKey('Bash', { command: 'curl https://api.example.com' }) === 'Bash:network',
  'curl → Bash:network',
);

assert(
  deriveContextKey('Bash', { command: 'ls -la' }) === 'Bash:general',
  'ls → Bash:general',
);

assert(
  deriveContextKey('Edit', { file_path: 'src/utils/__tests__/helper.test.ts' }) === 'Edit:test',
  'edit test file → Edit:test',
);

assert(
  deriveContextKey('Edit', { file_path: '.env.local' }) === 'Edit:config',
  'edit .env → Edit:config',
);

assert(
  deriveContextKey('Edit', { file_path: 'src/App.tsx' }) === 'Edit:source',
  'edit source → Edit:source',
);

assert(
  deriveContextKey('Read', { file_path: '.env' }) === 'Read:config',
  'read .env → Read:config',
);

assert(
  deriveContextKey('Read', { file_path: 'package.json' }) === 'Read:deps',
  'read package.json → Read:deps',
);

assert(
  deriveContextKey('Glob', { pattern: '**/*.tsx' }) === 'Glob:typescript',
  'glob tsx → Glob:typescript',
);

assert(
  deriveContextKey('Glob', { pattern: '**/*.test.ts' }) === 'Glob:test',
  'glob test → Glob:test',
);

assert(
  deriveContextKey('WebSearch', {}) === 'tool:websearch',
  'unknown tool → tool:websearch',
);

// ---------------------------------------------------------------------------
// getReliability
// ---------------------------------------------------------------------------

console.log('\ngetReliability:');

const mockModel = {
  categories: {
    'Bash:git_push': { alpha: 3, beta: 7 },
    'Bash:npm_test': { alpha: 9, beta: 1 },
    bash: { alpha: 6, beta: 4 },
    'tool:bash': { alpha: 6, beta: 4 },
  },
};

assert(
  Math.abs(getReliability(mockModel, 'Bash:git_push') - 0.3) < 0.01,
  'exact match: git_push reliability=0.3',
);

assert(
  Math.abs(getReliability(mockModel, 'Bash:npm_test') - 0.9) < 0.01,
  'exact match: npm_test reliability=0.9',
);

assert(
  Math.abs(getReliability(mockModel, 'Bash:unknown_cmd') - 0.6) < 0.01,
  'fallback to parent: Bash reliability=0.6',
);

assert(
  Math.abs(getReliability(mockModel, 'Edit:source') - 0.5) < 0.01,
  'no match → uninformative prior 0.5',
);

assert(
  Math.abs(getReliability(null, 'Bash:git_push') - 0.5) < 0.01,
  'null model → 0.5',
);

// ---------------------------------------------------------------------------
// buildWarning
// ---------------------------------------------------------------------------

console.log('\nbuildWarning:');

const warning = buildWarning('Bash:git_push', 0.3);
assert(warning.includes('CAUTION'), 'warning includes CAUTION');
assert(warning.includes('Bash:git_push'), 'warning includes context key');
assert(warning.includes('0.300'), 'warning includes mu value');
assert(warning.length <= 200, 'warning respects MAX_CONTEXT_LEN');

// ---------------------------------------------------------------------------
// Threshold
// ---------------------------------------------------------------------------

console.log('\nthreshold:');

assert(WEAK_ARM_THRESHOLD === 0.6, 'default threshold is 0.6');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${'═'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${'═'.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
