'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  selectHarness,
  selectHarnessName,
  extractCommandText,
  listHarnesses,
  getHarnessPath,
  HARNESSES,
  CODE_EDIT_TOOL_NAMES,
} = require('../scripts/harness-selector');

// ---------------------------------------------------------------------------
// extractCommandText
// ---------------------------------------------------------------------------

describe('extractCommandText', () => {
  it('extracts from string input', () => {
    assert.strictEqual(extractCommandText('git push origin main'), 'git push origin main');
  });

  it('extracts command field from Bash tool object', () => {
    assert.strictEqual(
      extractCommandText({ command: 'npm publish' }),
      'npm publish'
    );
  });

  it('extracts file_path from Edit tool object', () => {
    assert.strictEqual(
      extractCommandText({ file_path: 'src/index.js', new_string: 'x', old_string: 'y' }),
      'src/index.js'
    );
  });

  it('returns empty string for null/undefined', () => {
    assert.strictEqual(extractCommandText(null), '');
    assert.strictEqual(extractCommandText(undefined), '');
  });

  it('serialises unknown object shapes to JSON', () => {
    const text = extractCommandText({ foo: 'bar' });
    assert.ok(text.includes('bar'), 'should contain the value');
  });
});

// ---------------------------------------------------------------------------
// selectHarnessName — deploy
// ---------------------------------------------------------------------------

describe('selectHarnessName — deploy harness', () => {
  it('detects railway deploy', () => {
    assert.strictEqual(
      selectHarnessName('Bash', { command: 'railway deploy' }),
      'deploy'
    );
  });

  it('detects npm publish', () => {
    assert.strictEqual(
      selectHarnessName('Bash', { command: 'npm publish --access public' }),
      'deploy'
    );
  });

  it('detects git push', () => {
    assert.strictEqual(
      selectHarnessName('Bash', { command: 'git push origin main' }),
      'deploy'
    );
  });

  it('detects docker push', () => {
    assert.strictEqual(
      selectHarnessName('Bash', { command: 'docker push myrepo/image:latest' }),
      'deploy'
    );
  });

  it('detects gh pr create', () => {
    assert.strictEqual(
      selectHarnessName('Bash', { command: 'gh pr create --title "fix: bug"' }),
      'deploy'
    );
  });
});

// ---------------------------------------------------------------------------
// selectHarnessName — db-write
// ---------------------------------------------------------------------------

describe('selectHarnessName — db-write harness', () => {
  it('detects DROP TABLE', () => {
    assert.strictEqual(
      selectHarnessName('Bash', { command: 'sqlite3 app.db "DROP TABLE users;"' }),
      'db-write'
    );
  });

  it('detects DELETE FROM', () => {
    assert.strictEqual(
      selectHarnessName('Bash', { command: 'DELETE FROM sessions;' }),
      'db-write'
    );
  });

  it('detects TRUNCATE', () => {
    assert.strictEqual(
      selectHarnessName('Bash', { command: 'TRUNCATE TABLE feedback;' }),
      'db-write'
    );
  });

  it('detects ALTER TABLE', () => {
    assert.strictEqual(
      selectHarnessName('Bash', { command: 'ALTER TABLE lessons ADD COLUMN score REAL;' }),
      'db-write'
    );
  });

  it('detects sqlite3 file removal', () => {
    assert.strictEqual(
      selectHarnessName('Bash', { command: 'rm -f .claude/memory/lessons.sqlite' }),
      'db-write'
    );
  });
});

// ---------------------------------------------------------------------------
// selectHarnessName — code-edit
// ---------------------------------------------------------------------------

describe('selectHarnessName — code-edit harness', () => {
  it('detects Edit tool', () => {
    assert.strictEqual(
      selectHarnessName('Edit', { file_path: 'src/index.js', old_string: 'x', new_string: 'y' }),
      'code-edit'
    );
  });

  it('detects Write tool', () => {
    assert.strictEqual(
      selectHarnessName('Write', { file_path: 'src/new.js', content: 'module.exports = {}' }),
      'code-edit'
    );
  });

  it('detects MultiEdit tool', () => {
    assert.strictEqual(
      selectHarnessName('MultiEdit', { file_path: 'src/app.js', edits: [] }),
      'code-edit'
    );
  });
});

// ---------------------------------------------------------------------------
// selectHarnessName — null (no match)
// ---------------------------------------------------------------------------

describe('selectHarnessName — null for non-matching patterns', () => {
  it('returns null for innocuous bash commands', () => {
    assert.strictEqual(
      selectHarnessName('Bash', { command: 'npm test' }),
      null
    );
  });

  it('returns null for read-only tools', () => {
    assert.strictEqual(selectHarnessName('Read', { file_path: 'README.md' }), null);
    assert.strictEqual(selectHarnessName('Glob', { pattern: '**/*.js' }), null);
  });

  it('returns null for empty input', () => {
    assert.strictEqual(selectHarnessName('Bash', {}), null);
  });
});

// ---------------------------------------------------------------------------
// THUMBGATE_HARNESS env override
// ---------------------------------------------------------------------------

describe('THUMBGATE_HARNESS env override', () => {
  before(() => { process.env.THUMBGATE_HARNESS = 'deploy'; });
  after(() => { delete process.env.THUMBGATE_HARNESS; });

  it('env override wins over tool-based detection', () => {
    // Edit tool would normally return 'code-edit' — env override should win
    assert.strictEqual(
      selectHarnessName('Edit', { file_path: 'src/app.js' }),
      'deploy'
    );
  });
});

// ---------------------------------------------------------------------------
// selectHarness returns a valid path
// ---------------------------------------------------------------------------

describe('selectHarness returns valid file paths', () => {
  const fs = require('fs');

  it('deploy harness file exists on disk', () => {
    const p = selectHarness('Bash', { command: 'git push origin main' });
    assert.ok(p, 'should return a path');
    assert.ok(fs.existsSync(p), `harness file should exist: ${p}`);
  });

  it('code-edit harness file exists on disk', () => {
    const p = selectHarness('Write', { file_path: 'x.js' });
    assert.ok(p, 'should return a path');
    assert.ok(fs.existsSync(p), `harness file should exist: ${p}`);
  });

  it('db-write harness file exists on disk', () => {
    const p = selectHarness('Bash', { command: 'DROP TABLE users;' });
    assert.ok(p, 'should return a path');
    assert.ok(fs.existsSync(p), `harness file should exist: ${p}`);
  });
});

// ---------------------------------------------------------------------------
// listHarnesses / getHarnessPath
// ---------------------------------------------------------------------------

describe('listHarnesses and getHarnessPath', () => {
  it('lists all three harnesses', () => {
    const names = listHarnesses();
    assert.ok(names.includes('deploy'), 'should include deploy');
    assert.ok(names.includes('code-edit'), 'should include code-edit');
    assert.ok(names.includes('db-write'), 'should include db-write');
  });

  it('getHarnessPath returns a string for known names', () => {
    for (const name of listHarnesses()) {
      const p = getHarnessPath(name);
      assert.ok(typeof p === 'string', `path should be a string for ${name}`);
    }
  });

  it('getHarnessPath returns null for unknown names', () => {
    assert.strictEqual(getHarnessPath('nonexistent'), null);
  });
});

// ---------------------------------------------------------------------------
// CODE_EDIT_TOOL_NAMES
// ---------------------------------------------------------------------------

describe('CODE_EDIT_TOOL_NAMES', () => {
  it('includes Edit, Write, MultiEdit', () => {
    assert.ok(CODE_EDIT_TOOL_NAMES.has('Edit'));
    assert.ok(CODE_EDIT_TOOL_NAMES.has('Write'));
    assert.ok(CODE_EDIT_TOOL_NAMES.has('MultiEdit'));
  });

  it('does not include Bash or Read', () => {
    assert.ok(!CODE_EDIT_TOOL_NAMES.has('Bash'));
    assert.ok(!CODE_EDIT_TOOL_NAMES.has('Read'));
  });
});
