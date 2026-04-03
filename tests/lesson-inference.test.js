'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  inferStructuredLesson,
  extractTrigger,
  extractAction,
  extractToolCalls,
  extractFilePaths,
  extractErrors,
  calculateConfidence,
  inferScope,
} = require('../scripts/lesson-inference');

describe('inferStructuredLesson', () => {
  it('returns a structured rule for negative signal conversation', () => {
    const window = [
      { role: 'user', content: 'Fix the login crash when password is empty' },
      { role: 'assistant', content: 'I edited src/auth/login.ts and removed the null check' },
      { role: 'user', content: 'That made it worse, now it crashes on all logins' },
    ];
    const rule = inferStructuredLesson(window, 'negative', 'login crash');
    assert.equal(rule.format, 'if-then-v1');
    assert.equal(rule.signal, 'negative');
    assert.equal(rule.action.type, 'avoid');
    assert.ok(rule.trigger.condition);
    assert.ok(rule.examples.length > 0);
    assert.equal(rule.examples[0].outcome, 'rejected');
    assert.ok(rule.metadata.inferredAt);
    assert.equal(rule.metadata.conversationLength, 3);
  });

  it('returns a structured rule for positive signal conversation', () => {
    const window = [
      { role: 'user', content: 'Implement the dark mode toggle in settings' },
      { role: 'assistant', content: 'Added useAppTheme hook and toggled colors via theme context' },
    ];
    const rule = inferStructuredLesson(window, 'positive', 'dark mode');
    assert.equal(rule.signal, 'positive');
    assert.equal(rule.action.type, 'do');
    assert.ok(rule.action.description.includes('Repeat this approach'));
    assert.equal(rule.examples[0].outcome, 'approved');
  });

  it('includes tool calls and file paths in metadata', () => {
    const window = [
      { role: 'user', content: 'Check src/features/menu/hooks/useMenu.ts for bugs' },
      { role: 'assistant', content: 'Read(src/features/menu/hooks/useMenu.ts) found the issue. Edit(src/features/menu/hooks/useMenu.ts) applied fix.' },
    ];
    const rule = inferStructuredLesson(window, 'positive', '');
    assert.ok(rule.metadata.toolsUsed.includes('Read'));
    assert.ok(rule.metadata.toolsUsed.includes('Edit'));
    assert.ok(rule.metadata.filesInvolved.length > 0);
  });

  it('includes error patterns in metadata', () => {
    const window = [
      { role: 'user', content: 'TypeError: Cannot read property x of undefined' },
      { role: 'assistant', content: 'The 401 Unauthorized error means the token expired' },
    ];
    const rule = inferStructuredLesson(window, 'negative', 'auth error');
    assert.ok(rule.metadata.errorPatterns.length > 0);
  });
});

describe('extractTrigger', () => {
  it('matches debugging pattern', () => {
    const result = extractTrigger('Fix the authentication failure in production', '', 'negative');
    assert.equal(result.type, 'debugging');
    assert.ok(result.condition.includes('authentication failure'));
  });

  it('matches implementation pattern', () => {
    const result = extractTrigger('Implement the new payment flow with Stripe', '', 'positive');
    assert.equal(result.type, 'implementation');
    assert.ok(result.condition.includes('payment flow'));
  });

  it('matches question pattern', () => {
    const result = extractTrigger('Why does the menu fail to load on Android?', '', 'negative');
    assert.equal(result.type, 'question');
  });

  it('matches error-report pattern', () => {
    const result = extractTrigger('Error: ENOENT no such file or directory for config.json', '', 'negative');
    assert.equal(result.type, 'error-report');
  });

  it('matches constraint pattern', () => {
    const result = extractTrigger("Don't ever modify the .env file without asking first", '', 'negative');
    assert.equal(result.type, 'constraint');
  });

  it('falls back to general for unrecognized patterns', () => {
    const result = extractTrigger('hello there', '', 'positive');
    assert.equal(result.type, 'general');
    assert.equal(result.condition, 'hello there');
  });
});

describe('extractAction', () => {
  it('returns do action for positive signal', () => {
    const result = extractAction('Used memoization to fix re-render issue', 'positive');
    assert.equal(result.type, 'do');
    assert.ok(result.description.includes('Repeat this approach'));
  });

  it('returns avoid action for negative signal', () => {
    const result = extractAction('Deleted the auth token from .env', 'negative');
    assert.equal(result.type, 'avoid');
    assert.ok(result.description.includes('Avoid this approach'));
  });
});

describe('extractToolCalls', () => {
  it('extracts tool names from Claude-style output', () => {
    const window = [
      { role: 'assistant', content: 'Read(file.ts) then Bash(npm test) and Edit(file.ts)' },
      { role: 'assistant', content: 'Grep(pattern) found matches, Glob(*.ts) listed files' },
    ];
    const tools = extractToolCalls(window);
    assert.ok(tools.includes('Read'));
    assert.ok(tools.includes('Bash'));
    assert.ok(tools.includes('Edit'));
    assert.ok(tools.includes('Grep'));
    assert.ok(tools.includes('Glob'));
  });

  it('returns empty array when no tool calls present', () => {
    const window = [{ role: 'user', content: 'Just a plain message' }];
    assert.deepEqual(extractToolCalls(window), []);
  });

  it('deduplicates tool names', () => {
    const window = [
      { role: 'assistant', content: 'Read(a.ts) then Read(b.ts)' },
    ];
    const tools = extractToolCalls(window);
    assert.equal(tools.filter(t => t === 'Read').length, 1);
  });
});

describe('extractFilePaths', () => {
  it('extracts paths from mixed content', () => {
    const window = [
      { role: 'user', content: 'Check src/features/menu/hooks/useMenu.ts and scripts/build.js' },
      { role: 'assistant', content: 'Found issue in adapters/mcp/server.js and tests/api.test.js' },
    ];
    const paths = extractFilePaths(window);
    assert.ok(paths.some(p => p.includes('src/features/menu')));
    assert.ok(paths.some(p => p.includes('scripts/build.js')));
    assert.ok(paths.some(p => p.includes('adapters/mcp')));
    assert.ok(paths.some(p => p.includes('tests/api.test.js')));
  });

  it('returns empty array when no file paths present', () => {
    const window = [{ role: 'user', content: 'No files here' }];
    assert.deepEqual(extractFilePaths(window), []);
  });

  it('handles .claude/ paths', () => {
    const window = [{ role: 'assistant', content: 'Edited .claude/settings.json' }];
    const paths = extractFilePaths(window);
    assert.ok(paths.some(p => p.includes('.claude/')));
  });
});

describe('extractErrors', () => {
  it('extracts error messages from conversation', () => {
    const window = [
      { role: 'user', content: 'TypeError: Cannot read properties of undefined' },
      { role: 'assistant', content: 'The 401 response means the token is invalid' },
    ];
    const errors = extractErrors(window);
    assert.ok(errors.length >= 2);
    assert.ok(errors.some(e => /TypeError/i.test(e)));
    assert.ok(errors.some(e => /401/.test(e)));
  });

  it('extracts FAIL patterns', () => {
    const window = [
      { role: 'assistant', content: 'FAIL tests/api.test.js - assertion failed' },
    ];
    const errors = extractErrors(window);
    assert.ok(errors.length > 0);
  });

  it('returns empty array when no errors present', () => {
    const window = [{ role: 'user', content: 'Everything looks good' }];
    assert.deepEqual(extractErrors(window), []);
  });
});

describe('calculateConfidence', () => {
  it('starts at 0.5 for minimal window', () => {
    const window = [{ role: 'user', content: 'hi' }];
    assert.equal(calculateConfidence(window, ''), 0.5);
  });

  it('increases with window size >= 3', () => {
    const window = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ];
    assert.ok(calculateConfidence(window, '') >= 0.6);
  });

  it('increases with window size >= 5', () => {
    const window = Array.from({ length: 5 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg ${i}`,
    }));
    assert.ok(calculateConfidence(window, '') >= 0.7);
  });

  it('increases with longer context', () => {
    const window = [{ role: 'user', content: 'hi' }];
    const short = calculateConfidence(window, 'short');
    const long = calculateConfidence(window, 'This is a much longer context string that exceeds twenty characters');
    assert.ok(long > short);
  });

  it('increases when file paths are present', () => {
    const withFiles = [{ role: 'user', content: 'Check src/index.ts' }];
    const noFiles = [{ role: 'user', content: 'Just a question' }];
    assert.ok(calculateConfidence(withFiles, '') > calculateConfidence(noFiles, ''));
  });

  it('caps at 1.0', () => {
    const window = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `working on src/features/thing${i}.ts with scripts/build.js`,
    }));
    assert.ok(calculateConfidence(window, 'A very long context string that is definitely over twenty characters') <= 1.0);
  });
});

describe('inferScope', () => {
  it('returns global when no files or tools', () => {
    assert.equal(inferScope([], []), 'global');
  });

  it('returns file-level for 1-2 files', () => {
    assert.equal(inferScope(['src/a.ts'], ['Read']), 'file-level');
    assert.equal(inferScope(['src/a.ts', 'src/b.ts'], []), 'file-level');
  });

  it('returns project-level for 3+ files', () => {
    assert.equal(inferScope(['src/a.ts', 'src/b.ts', 'src/c.ts'], []), 'project-level');
  });
});
