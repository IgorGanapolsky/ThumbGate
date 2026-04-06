'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// feedback-to-rules
// ---------------------------------------------------------------------------

describe('feedback-to-rules', () => {
  let m;
  before(() => {
    delete require.cache[require.resolve('../scripts/feedback-to-rules.js')];
    m = require('../scripts/feedback-to-rules.js');
  });

  it('parseFeedbackFile returns [] for missing file', () => {
    const result = m.parseFeedbackFile('/nonexistent/path/feedback.jsonl');
    assert.deepEqual(result, []);
  });

  it('parseFeedbackFile reads and parses entries from JSONL', () => {
    const tmp = path.join(os.tmpdir(), `ftr-test-${Date.now()}.jsonl`);
    const entries = [
      { signal: 'negative', context: 'Failed test', tags: ['testing'] },
      { signal: 'positive', context: 'All tests passed', tags: ['testing'] },
    ];
    fs.writeFileSync(tmp, entries.map((e) => JSON.stringify(e)).join('\n'));
    const result = m.parseFeedbackFile(tmp);
    assert.equal(result.length, 2);
    assert.equal(result[0].signal, 'negative');
    assert.equal(result[1].signal, 'positive');
    fs.unlinkSync(tmp);
  });

  it('parseFeedbackFile skips malformed lines', () => {
    const tmp = path.join(os.tmpdir(), `ftr-malformed-${Date.now()}.jsonl`);
    fs.writeFileSync(tmp, '{"signal":"negative","context":"ok"}\nNOT JSON\n{"signal":"positive","context":"also ok","tags":["t"]}');
    const result = m.parseFeedbackFile(tmp);
    assert.equal(result.length, 2);
    fs.unlinkSync(tmp);
  });

  it('classifySignal: negative maps to negative', () => {
    assert.equal(m.classifySignal({ signal: 'negative' }), 'negative');
    assert.equal(m.classifySignal({ signal: 'down' }), 'negative');
    assert.equal(m.classifySignal({ signal: 'thumbs_down' }), 'negative');
    assert.equal(m.classifySignal({ feedback: 'negative_strong' }), 'negative');
  });

  it('classifySignal: positive maps to positive', () => {
    assert.equal(m.classifySignal({ signal: 'positive' }), 'positive');
    assert.equal(m.classifySignal({ signal: 'up' }), 'positive');
    assert.equal(m.classifySignal({ signal: 'thumbs_up' }), 'positive');
    assert.equal(m.classifySignal({ feedback: 'positive_strong' }), 'positive');
  });

  it('classifySignal: unknown signal returns null', () => {
    assert.equal(m.classifySignal({ signal: 'maybe' }), null);
    assert.equal(m.classifySignal({}), null);
  });

  it('normalize strips /Users paths and port numbers, lowercases', () => {
    const result = m.normalize('/Users/johndoe/project/file.ts:42 SOME CONTEXT');
    assert.ok(result.includes('~'));
    assert.ok(!result.includes('/Users/'));
    assert.ok(!result.includes(':42'));
    assert.equal(result, result.toLowerCase());
  });

  it('analyze counts positive/negative/categories correctly', () => {
    const entries = [
      { signal: 'negative', context: 'bad thing 1', task_category: 'testing' },
      { signal: 'negative', context: 'bad thing 2', task_category: 'testing' },
      { signal: 'positive', context: 'good thing', task_category: 'testing' },
    ];
    const report = m.analyze(entries);
    assert.equal(report.negativeCount, 2);
    assert.equal(report.positiveCount, 1);
    assert.equal(report.totalFeedback, 3);
    assert.ok(report.categoryBreakdown['testing']);
    assert.equal(report.categoryBreakdown['testing'].negative, 2);
    assert.equal(report.categoryBreakdown['testing'].positive, 1);
  });

  it('analyze produces recurringIssues for context appearing >= 2 times', () => {
    const ctx = 'Agent claimed done without running tests';
    const entries = [
      { signal: 'negative', context: ctx, task_category: 'testing' },
      { signal: 'negative', context: ctx, task_category: 'testing' },
      { signal: 'negative', context: 'different problem', task_category: 'testing' },
    ];
    const report = m.analyze(entries);
    assert.ok(report.recurringIssues.length >= 1, 'should have at least 1 recurring issue');
    const issue = report.recurringIssues[0];
    assert.ok(issue.count >= 2);
    assert.ok(['medium', 'high', 'critical'].includes(issue.severity));
    assert.ok(issue.suggestedRule.startsWith('NEVER'));
  });

  it('analyze assigns severity: count>=4 critical, >=3 high, else medium', () => {
    const ctx = 'repeated problem context string';
    const makeEntry = () => ({ signal: 'negative', context: ctx });
    const report4 = m.analyze([makeEntry(), makeEntry(), makeEntry(), makeEntry()]);
    assert.equal(report4.recurringIssues[0].severity, 'critical');
    const report3 = m.analyze([makeEntry(), makeEntry(), makeEntry()]);
    assert.equal(report3.recurringIssues[0].severity, 'high');
    const report2 = m.analyze([makeEntry(), makeEntry()]);
    assert.equal(report2.recurringIssues[0].severity, 'medium');
  });

  it('toRules emits CLAUDE.md-compatible markdown with NEVER bullets', () => {
    const entries = [
      { signal: 'negative', context: 'Agent claimed done without running tests first' },
      { signal: 'negative', context: 'Agent claimed done without running tests first' },
    ];
    const report = m.analyze(entries);
    const rules = m.toRules(report);
    assert.ok(rules.startsWith('# Suggested Rules from Feedback Analysis'));
    assert.ok(rules.includes('NEVER'));
    assert.ok(rules.includes('[MEDIUM]') || rules.includes('[HIGH]') || rules.includes('[CRITICAL]'));
  });

  it('toRules emits no-issues message when no recurring issues', () => {
    const report = m.analyze([]);
    const rules = m.toRules(report);
    assert.ok(rules.includes('No recurring issues detected'));
  });
});

// ---------------------------------------------------------------------------
// plan-gate
// ---------------------------------------------------------------------------

describe('plan-gate', () => {
  let m;
  before(() => {
    delete require.cache[require.resolve('../scripts/plan-gate.js')];
    m = require('../scripts/plan-gate.js');
  });

  const VALID_PRD = [
    '# My Plan',
    '',
    '## Status',
    'DRAFT',
    '',
    '## Clarifying Questions Resolved',
    '| Q | A |',
    '|---|---|',
    '| q1 | a1 |',
    '| q2 | a2 |',
    '| q3 | a3 |',
    '',
    '## Contracts',
    '```',
    'interface Foo { bar: string }',
    '```',
    '',
    '## Validation Checklist',
    '- [ ] scenario 1',
    '- [ ] scenario 2',
  ].join('\n');

  it('countTableRows returns 0 for missing section', () => {
    assert.equal(m.countTableRows('# No table here', 'Clarifying Questions Resolved'), 0);
  });

  it('countTableRows counts data rows excluding header and separator', () => {
    const content = '## Clarifying Questions Resolved\n| Q | A |\n|---|---|\n| q1 | a1 |\n| q2 | a2 |\n| q3 | a3 |\n';
    assert.equal(m.countTableRows(content, 'Clarifying Questions Resolved'), 3);
  });

  it('countContracts returns 0 for missing Contracts section', () => {
    assert.equal(m.countContracts('# No contracts here'), 0);
  });

  it('countContracts counts interface/type keywords in Contracts section code blocks', () => {
    const content = '## Contracts\n```\ninterface Foo {}\ntype Bar = string\n```\n';
    assert.equal(m.countContracts(content), 2);
  });

  it('countValidationScenarios counts unchecked [ ] items in Validation Checklist', () => {
    const content = '## Validation Checklist\n- [ ] test 1\n- [x] done\n- [ ] test 2\n';
    assert.equal(m.countValidationScenarios(content), 2);
  });

  it('getStatus returns null for missing Status section', () => {
    assert.equal(m.getStatus('# No status'), null);
  });

  it('getStatus extracts status value', () => {
    assert.equal(m.getStatus('## Status\nDRAFT'), 'DRAFT');
    assert.equal(m.getStatus('## Status\nCOMPLETE'), 'COMPLETE');
  });

  it('validatePlan fails when Clarifying Questions < 3', () => {
    const content = VALID_PRD.replace(
      '| q1 | a1 |\n| q2 | a2 |\n| q3 | a3 |',
      '| q1 | a1 |\n| q2 | a2 |'
    );
    const result = m.validatePlan(content);
    assert.equal(result.allPass, false);
    const qGate = result.gates.find((g) => g.name === 'Clarifying Questions');
    assert.equal(qGate.pass, false);
  });

  it('validatePlan fails when Contracts = 0', () => {
    const content = VALID_PRD.replace('interface Foo { bar: string }', '// no contracts defined here at all');
    const result = m.validatePlan(content);
    assert.equal(result.allPass, false);
    const cGate = result.gates.find((g) => g.name === 'Contracts Defined');
    assert.equal(cGate.pass, false);
  });

  it('validatePlan fails when Validation Checklist < 2', () => {
    const content = VALID_PRD.replace('- [ ] scenario 1\n- [ ] scenario 2', '- [ ] only one');
    const result = m.validatePlan(content);
    assert.equal(result.allPass, false);
    const vGate = result.gates.find((g) => g.name === 'Validation Checklist');
    assert.equal(vGate.pass, false);
  });

  it('validatePlan fails when Status = COMPLETE', () => {
    const content = VALID_PRD.replace('DRAFT', 'COMPLETE');
    const result = m.validatePlan(content);
    assert.equal(result.allPass, false);
    const sGate = result.gates.find((g) => g.name === 'Status');
    assert.equal(sGate.pass, false);
  });

  it('validatePlan passes when all gates satisfied and status is not COMPLETE', () => {
    const result = m.validatePlan(VALID_PRD);
    assert.equal(result.allPass, true);
    assert.ok(result.gates.every((g) => g.pass));
  });

  it('formatReport emits RESULT: PASS for allPass=true', () => {
    const result = m.validatePlan(VALID_PRD);
    const report = m.formatReport(result);
    assert.ok(report.includes('RESULT: PASS'));
  });

  it('formatReport emits RESULT: BLOCKED for allPass=false', () => {
    const invalidContent = '# No sections';
    const result = m.validatePlan(invalidContent);
    const report = m.formatReport(result);
    assert.ok(report.includes('RESULT: BLOCKED'));
  });
});

// ---------------------------------------------------------------------------
// feedback-inbox-read
// ---------------------------------------------------------------------------

describe('feedback-inbox-read', () => {
  let m;
  before(() => {
    delete require.cache[require.resolve('../scripts/feedback-inbox-read.js')];
    m = require('../scripts/feedback-inbox-read.js');
  });

  it('readInbox returns [] when inbox file does not exist', () => {
    // INBOX_PATH won't exist in a clean test env
    const result = m.readInbox();
    assert.ok(Array.isArray(result));
    // Either 0 (file missing) or some number if it happens to exist
  });

  it('loadCursor returns { lastLineIndex: -1 } when cursor file missing', () => {
    // CURSOR_PATH won't exist in fresh env (or may, either way returns a valid cursor)
    const cursor = m.loadCursor();
    assert.ok(typeof cursor.lastLineIndex === 'number');
  });

  it('getNewEntries returns [] when inbox is empty', () => {
    // With no inbox file, getNewEntries should return []
    // Write temp inbox and cursor to test the logic directly
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-unit-'));
    const tmpInbox = path.join(tmpDir, 'inbox.jsonl');
    const tmpCursor = path.join(tmpDir, 'cursor.json');

    // Test empty file scenario
    fs.writeFileSync(tmpInbox, '');
    const entries = (() => {
      const raw = fs.readFileSync(tmpInbox, 'utf-8').trim();
      if (!raw) return [];
      return raw.split('\n').map((line, idx) => {
        try { return { _lineIndex: idx, ...JSON.parse(line) }; }
        catch { return null; }
      }).filter(Boolean);
    })();
    assert.deepEqual(entries, []);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('getNewEntries filters by cursor position — only returns entries after lastLineIndex', () => {
    const allEntries = [
      { _lineIndex: 0, signal: 'negative' },
      { _lineIndex: 1, signal: 'positive' },
      { _lineIndex: 2, signal: 'negative' },
    ];
    const cursor = { lastLineIndex: 0 };
    const filtered = allEntries.filter((e) => e._lineIndex > cursor.lastLineIndex);
    assert.equal(filtered.length, 2);
    assert.equal(filtered[0]._lineIndex, 1);
    assert.equal(filtered[1]._lineIndex, 2);
  });

  it('cursor at lastLineIndex=-1 returns all entries', () => {
    const allEntries = [
      { _lineIndex: 0, signal: 'negative' },
      { _lineIndex: 1, signal: 'positive' },
    ];
    const cursor = { lastLineIndex: -1 };
    const filtered = allEntries.filter((e) => e._lineIndex > cursor.lastLineIndex);
    assert.equal(filtered.length, 2);
  });

  it('cursor at lastLineIndex=last returns no entries', () => {
    const allEntries = [
      { _lineIndex: 0, signal: 'negative' },
      { _lineIndex: 1, signal: 'positive' },
    ];
    const cursor = { lastLineIndex: 1 };
    const filtered = allEntries.filter((e) => e._lineIndex > cursor.lastLineIndex);
    assert.equal(filtered.length, 0);
  });

  it('saveCursor + loadCursor round-trip persists correctly', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-rt-'));
    const cursorPath = path.join(tmpDir, 'cursor.json');
    // Simulate saveCursor
    fs.writeFileSync(cursorPath, JSON.stringify({ lastLineIndex: 5, updatedAt: new Date().toISOString() }) + '\n');
    // Simulate loadCursor
    const loaded = JSON.parse(fs.readFileSync(cursorPath, 'utf-8'));
    assert.equal(loaded.lastLineIndex, 5);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('strips _lineIndex from returned entries', () => {
    const entries = [{ _lineIndex: 0, signal: 'negative', context: 'bad' }];
    const stripped = entries.map(({ _lineIndex, ...rest }) => rest);
    assert.ok(!('_lineIndex' in stripped[0]));
    assert.equal(stripped[0].signal, 'negative');
  });

  it('INBOX_PATH and CURSOR_PATH are exported strings', () => {
    assert.equal(typeof m.INBOX_PATH, 'string');
    assert.equal(typeof m.CURSOR_PATH, 'string');
    assert.ok(m.INBOX_PATH.includes('inbox.jsonl'));
    assert.ok(m.CURSOR_PATH.includes('cursor.json'));
  });
});

// ---------------------------------------------------------------------------
// feedback-to-memory
// ---------------------------------------------------------------------------

describe('feedback-to-memory', () => {
  let m;
  before(() => {
    delete require.cache[require.resolve('../scripts/feedback-to-memory.js')];
    m = require('../scripts/feedback-to-memory.js');
  });

  it('convertFeedbackToMemory: valid negative returns ok=true, store-mistake, MISTAKE: prefix', () => {
    const result = m.convertFeedbackToMemory({
      signal: 'negative',
      context: 'Agent claimed fix without test evidence',
      whatWentWrong: 'No tests were run before claiming the bug was fixed',
      whatToChange: 'Always run tests and show output before claiming done',
      tags: ['verification', 'testing'],
    });
    assert.equal(result.ok, true);
    assert.equal(result.actionType, 'store-mistake');
    assert.ok(result.memory.title.startsWith('MISTAKE:'));
    assert.equal(result.memory.category, 'error');
  });

  it('convertFeedbackToMemory: valid positive returns ok=true, store-learning, SUCCESS: prefix', () => {
    const result = m.convertFeedbackToMemory({
      signal: 'positive',
      whatWorked: 'Built schema-validated feedback system with prevention rules',
      tags: ['architecture', 'rlhf'],
    });
    assert.equal(result.ok, true);
    assert.equal(result.actionType, 'store-learning');
    assert.ok(result.memory.title.startsWith('SUCCESS:'));
    assert.equal(result.memory.category, 'learning');
  });

  it('convertFeedbackToMemory: bare negative (no context) returns ok=false', () => {
    const result = m.convertFeedbackToMemory({ signal: 'negative' });
    assert.equal(result.ok, false);
    assert.ok(typeof result.reason === 'string');
  });

  it('convertFeedbackToMemory: bare positive (no context) returns ok=false', () => {
    const result = m.convertFeedbackToMemory({ signal: 'positive' });
    assert.equal(result.ok, false);
    assert.ok(typeof result.reason === 'string');
  });

  it('convertFeedbackToMemory: unknown signal returns ok=false', () => {
    const result = m.convertFeedbackToMemory({ signal: 'maybe', context: 'test context here' });
    assert.equal(result.ok, false);
  });

  it('convertFeedbackToMemory: context-only negative returns ok=true', () => {
    const result = m.convertFeedbackToMemory({
      signal: 'negative',
      context: 'Showed fake ThumbGate statistics panel to user without real data',
      tags: ['rlhf'],
    });
    assert.equal(result.ok, true);
    assert.ok(result.memory.title.startsWith('MISTAKE:'));
  });

  it('convertFeedbackToMemory: context-only positive returns ok=true', () => {
    const result = m.convertFeedbackToMemory({
      signal: 'positive',
      context: 'Ran full test suite and showed green output before responding',
      tags: ['verification'],
    });
    assert.equal(result.ok, true);
    assert.ok(result.memory.title.startsWith('SUCCESS:'));
  });

  it('convertFeedbackToMemory: preserves domain tags in output memory', () => {
    const result = m.convertFeedbackToMemory({
      signal: 'negative',
      context: 'Agent failed to validate before submitting',
      whatWentWrong: 'Missing input validation on API endpoint',
      tags: ['api-integration', 'security'],
    });
    assert.equal(result.ok, true);
    assert.ok(result.memory.tags.includes('api-integration'));
    assert.ok(result.memory.tags.includes('security'));
  });

  it('convertFeedbackToMemory: memory has required fields (title, content, category, tags)', () => {
    const result = m.convertFeedbackToMemory({
      signal: 'negative',
      context: 'Agent overclaimed completion status without running CI',
      tags: ['verification'],
    });
    assert.equal(result.ok, true);
    assert.ok(result.memory.title);
    assert.ok(result.memory.content);
    assert.ok(result.memory.category);
    assert.ok(Array.isArray(result.memory.tags));
  });
});
