'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const {
  exportFeedbackLog,
  exportMemoryLog,
  exportPreventionRules,
  exportGates,
  exportContextFsPacks,
  exportLessons,
  exportAll,
  slugify,
  yamlEscape,
  buildFrontmatter,
  wikiLink,
  parsePreventionRulesMarkdown,
} = require('../scripts/obsidian-export');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-export-test-'));
}

function cleanDir(dir) {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function appendJSONL(filePath, records) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(filePath, lines, 'utf-8');
}

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result = {};
  const lines = match[1].split('\n');
  let currentKey = null;
  let arrayValues = [];
  let inArray = false;

  for (const line of lines) {
    if (inArray && line.match(/^\s+-\s+/)) {
      let val = line.replace(/^\s+-\s+/, '').trim();
      // Remove surrounding quotes
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      arrayValues.push(val);
      continue;
    } else if (inArray) {
      result[currentKey] = arrayValues;
      inArray = false;
      arrayValues = [];
      currentKey = null;
    }

    const kvMatch = line.match(/^(\w+):\s*(.*)/);
    if (kvMatch) {
      const key = kvMatch[1];
      let value = kvMatch[2].trim();
      if (value === '' || value === undefined) {
        // Could be start of an array
        currentKey = key;
        inArray = true;
        arrayValues = [];
        continue;
      }
      if (value === '[]') {
        result[key] = [];
      } else if (value === 'true') {
        result[key] = true;
      } else if (value === 'false') {
        result[key] = false;
      } else {
        // Remove surrounding quotes
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        result[key] = value;
      }
    }
  }
  if (inArray && currentKey) {
    result[currentKey] = arrayValues;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

function sampleFeedbackEntries() {
  return [
    {
      id: 'fb_001',
      signal: 'negative',
      tags: ['testing', 'verification'],
      context: 'Skipped test verification before commit',
      whatWentWrong: 'Tests were not run',
      correctiveAction: 'Always run tests before committing',
      timestamp: '2026-03-20T10:00:00.000Z',
      toolName: 'run_tests',
      category: 'testing',
    },
    {
      id: 'fb_002',
      signal: 'positive',
      tags: ['documentation'],
      context: 'Clear API docs written',
      whatWorked: 'Structured documentation with examples',
      timestamp: '2026-03-21T14:30:00.000Z',
      category: 'documentation',
    },
  ];
}

function sampleMemoryEntries() {
  return [
    {
      id: 'mem_001',
      title: 'MISTAKE: Skipped verification',
      category: 'error',
      tags: ['testing', 'verification'],
      content: 'Always run tests before committing changes.',
      sourceFeedbackId: 'fb_001',
      timestamp: '2026-03-20T10:00:00.000Z',
    },
    {
      id: 'mem_002',
      title: 'LEARNING: API documentation approach',
      category: 'learning',
      tags: ['documentation'],
      content: 'Use structured docs with examples for APIs.',
      sourceFeedbackId: 'fb_002',
      timestamp: '2026-03-21T14:30:00.000Z',
    },
  ];
}

function samplePreventionRules() {
  return [
    '# Prevention Rules',
    '',
    '## Rule: Always run tests before committing',
    '',
    'When making code changes, run the test suite before committing.',
    'This prevents broken commits from entering the main branch.',
    '',
    '## Rule: Never force push to main',
    '',
    'Force pushing to main or master is blocked.',
    'Severity: critical',
    '',
  ].join('\n');
}

function sampleGatesConfig() {
  return {
    version: 1,
    gates: [
      {
        id: 'force-push',
        layer: 'Execution',
        pattern: 'git\\s+push\\s+(--force|-f)',
        action: 'block',
        message: 'Force push blocked. This is destructive and irreversible.',
        severity: 'critical',
      },
      {
        id: 'env-file-edit',
        layer: 'Cloud',
        trigger: 'Edit:env_file',
        pattern: '\\.env',
        action: 'warn',
        message: 'Editing .env file — verify you are not deleting existing tokens',
        severity: 'medium',
      },
    ],
  };
}

function sampleContextPacks() {
  return [
    {
      packId: 'pack_bug_001',
      template: 'bug-investigation',
      itemCount: 3,
      usedChars: 2500,
      timestamp: '2026-03-22T08:00:00.000Z',
      items: [
        { id: 'mem_001', namespace: 'memory/error', content: 'Skipped verification' },
        { id: 'rule_01', namespace: 'rules', content: 'Run tests first' },
      ],
      outcome: 'Bug identified and fixed',
    },
  ];
}

// ---------------------------------------------------------------------------
// Tests: Helper functions
// ---------------------------------------------------------------------------

test('slugify: converts text to slug', () => {
  assert.equal(slugify('Hello World!'), 'hello-world');
  assert.equal(slugify('foo--bar__baz'), 'foo-bar-baz');
  assert.equal(slugify(''), '');
  assert.equal(slugify(null), '');
});

test('slugify: respects max length', () => {
  const long = 'a'.repeat(200);
  assert.ok(slugify(long).length <= 80);
  assert.equal(slugify(long, 10).length, 10);
});

test('yamlEscape: wraps strings with colons in quotes', () => {
  const result = yamlEscape('title: with colon');
  assert.ok(result.startsWith('"'), 'Should be wrapped in quotes');
  assert.ok(result.includes('title: with colon'));
});

test('yamlEscape: returns empty quotes for null/undefined', () => {
  assert.equal(yamlEscape(null), '""');
  assert.equal(yamlEscape(undefined), '""');
  assert.equal(yamlEscape(''), '""');
});

test('yamlEscape: passes through simple strings', () => {
  assert.equal(yamlEscape('hello'), 'hello');
  assert.equal(yamlEscape('simple-slug'), 'simple-slug');
});

test('buildFrontmatter: creates valid YAML frontmatter block', () => {
  const fm = buildFrontmatter({ title: 'Test', type: 'note', tags: ['a', 'b'] });
  assert.ok(fm.startsWith('---\n'));
  assert.ok(fm.endsWith('\n---'));
  assert.ok(fm.includes('title: Test'));
  assert.ok(fm.includes('type: note'));
  assert.ok(fm.includes('  - a'));
  assert.ok(fm.includes('  - b'));
});

test('wikiLink: creates Obsidian-compatible wiki-links', () => {
  assert.equal(wikiLink('testing'), '[[testing]]');
  assert.equal(wikiLink('Rules/my-rule'), '[[Rules/my-rule]]');
});

test('parsePreventionRulesMarkdown: parses rules from markdown', () => {
  const rules = parsePreventionRulesMarkdown(samplePreventionRules());
  assert.ok(rules.length >= 2, 'Should parse at least 2 rules');
  assert.equal(rules[0].title, 'Always run tests before committing');
  assert.ok(rules[0].body.includes('test suite'));
  assert.equal(rules[1].title, 'Never force push to main');
  assert.equal(rules[1].severity, 'critical');
});

// ---------------------------------------------------------------------------
// Tests: exportFeedbackLog
// ---------------------------------------------------------------------------

test('exportFeedbackLog: creates correct markdown files with YAML frontmatter', () => {
  const tmpDir = makeTmpDir();
  const feedbackDir = path.join(tmpDir, 'feedback');
  const outputDir = path.join(tmpDir, 'output');

  try {
    appendJSONL(path.join(feedbackDir, 'feedback-log.jsonl'), sampleFeedbackEntries());
    const result = exportFeedbackLog(feedbackDir, outputDir);

    assert.equal(result.exported, 2);
    assert.deepEqual(result.errors, []);

    // Check files exist
    const feedbackOutDir = path.join(outputDir, 'Feedback');
    const files = fs.readdirSync(feedbackOutDir);
    assert.equal(files.length, 2);

    // Check first file content
    const file1 = files.find((f) => f.includes('skipped'));
    assert.ok(file1, 'Should have file with "skipped" in name');
    const content = readFile(path.join(feedbackOutDir, file1));

    // Verify YAML frontmatter
    assert.ok(content.startsWith('---\n'), 'Should start with frontmatter');
    const fm = parseFrontmatter(content);
    assert.equal(fm.signal, 'down');
    assert.equal(fm.sourceFeedbackId, 'fb_001');
    assert.equal(fm.date, '2026-03-20');

    // Verify wiki-links for tags
    assert.ok(content.includes('[[testing]]'), 'Should have testing wiki-link');
    assert.ok(content.includes('[[verification]]'), 'Should have verification wiki-link');

    // Verify body structure
    assert.ok(content.includes('# Skipped test verification before commit'));
    assert.ok(content.includes('## Context'));
    assert.ok(content.includes('## Corrective Action'));
  } finally {
    cleanDir(tmpDir);
  }
});

test('exportFeedbackLog: handles empty feedbackDir gracefully', () => {
  const tmpDir = makeTmpDir();
  try {
    const result = exportFeedbackLog(path.join(tmpDir, 'nonexistent'), path.join(tmpDir, 'out'));
    assert.equal(result.exported, 0);
    assert.deepEqual(result.errors, []);
  } finally {
    cleanDir(tmpDir);
  }
});

test('exportFeedbackLog: skips entries with missing id', () => {
  const tmpDir = makeTmpDir();
  const feedbackDir = path.join(tmpDir, 'feedback');
  const outputDir = path.join(tmpDir, 'output');

  try {
    appendJSONL(path.join(feedbackDir, 'feedback-log.jsonl'), [
      { signal: 'negative', context: 'No ID entry' },
      { id: 'fb_valid', signal: 'positive', context: 'Valid', timestamp: '2026-01-01T00:00:00Z' },
    ]);
    const result = exportFeedbackLog(feedbackDir, outputDir);
    assert.equal(result.exported, 1);
    assert.ok(result.errors.length > 0);
  } finally {
    cleanDir(tmpDir);
  }
});

// ---------------------------------------------------------------------------
// Tests: exportMemoryLog
// ---------------------------------------------------------------------------

test('exportMemoryLog: creates memory notes with wiki-links and backlinks', () => {
  const tmpDir = makeTmpDir();
  const feedbackDir = path.join(tmpDir, 'feedback');
  const outputDir = path.join(tmpDir, 'output');

  try {
    appendJSONL(path.join(feedbackDir, 'memory-log.jsonl'), sampleMemoryEntries());
    const result = exportMemoryLog(feedbackDir, outputDir);

    assert.equal(result.exported, 2);
    assert.deepEqual(result.errors, []);

    const memDir = path.join(outputDir, 'Memories');
    const files = fs.readdirSync(memDir);
    assert.equal(files.length, 2);

    // Check backlink in first memory
    const file1 = files.find((f) => f.includes('mistake'));
    const content = readFile(path.join(memDir, file1));
    assert.ok(content.includes('[[Feedback/fb_001]]'), 'Should have backlink to source feedback');
    assert.ok(content.includes('[[testing]]'), 'Should have tag wiki-link');

    const fm = parseFrontmatter(content);
    assert.equal(fm.category, 'error');
  } finally {
    cleanDir(tmpDir);
  }
});

// ---------------------------------------------------------------------------
// Tests: exportPreventionRules
// ---------------------------------------------------------------------------

test('exportPreventionRules: parses rules into individual notes + index', () => {
  const tmpDir = makeTmpDir();
  const feedbackDir = path.join(tmpDir, 'feedback');
  const outputDir = path.join(tmpDir, 'output');

  try {
    fs.mkdirSync(feedbackDir, { recursive: true });
    fs.writeFileSync(path.join(feedbackDir, 'prevention-rules.md'), samplePreventionRules());

    const result = exportPreventionRules(feedbackDir, outputDir);
    assert.ok(result.exported >= 2, 'Should export at least 2 rules');
    assert.deepEqual(result.errors, []);

    const rulesDir = path.join(outputDir, 'Rules');
    const files = fs.readdirSync(rulesDir);
    assert.ok(files.includes('Prevention Rules Index.md'), 'Should create index file');

    // Check index content
    const indexContent = readFile(path.join(rulesDir, 'Prevention Rules Index.md'));
    assert.ok(indexContent.includes('[[Rules/'), 'Index should contain wiki-links to rules');

    // Check a rule file
    const ruleFile = files.find((f) => f.includes('always-run-tests'));
    assert.ok(ruleFile, 'Should have a rule file for "always run tests"');
    const ruleContent = readFile(path.join(rulesDir, ruleFile));
    const fm = parseFrontmatter(ruleContent);
    assert.equal(fm.type, 'prevention-rule');
    assert.ok(fm.severity);
  } finally {
    cleanDir(tmpDir);
  }
});

test('exportPreventionRules: handles missing file gracefully', () => {
  const tmpDir = makeTmpDir();
  try {
    const result = exportPreventionRules(path.join(tmpDir, 'nonexistent'), path.join(tmpDir, 'out'));
    assert.equal(result.exported, 0);
    assert.deepEqual(result.errors, []);
  } finally {
    cleanDir(tmpDir);
  }
});

// ---------------------------------------------------------------------------
// Tests: exportGates
// ---------------------------------------------------------------------------

test('exportGates: reads gate config JSON and creates gate notes + index', () => {
  const tmpDir = makeTmpDir();
  const configPath = path.join(tmpDir, 'gates.json');
  const outputDir = path.join(tmpDir, 'output');

  try {
    fs.writeFileSync(configPath, JSON.stringify(sampleGatesConfig()), 'utf-8');
    const result = exportGates(configPath, outputDir);

    assert.equal(result.exported, 2);
    assert.deepEqual(result.errors, []);

    const gatesDir = path.join(outputDir, 'Gates');
    const files = fs.readdirSync(gatesDir);
    assert.ok(files.includes('Gates Index.md'), 'Should create gates index');
    assert.ok(files.includes('force-push.md'), 'Should create force-push gate note');
    assert.ok(files.includes('env-file-edit.md'), 'Should create env-file-edit gate note');

    // Check gate note content
    const gateContent = readFile(path.join(gatesDir, 'force-push.md'));
    assert.ok(gateContent.includes('block'), 'Should mention block action');
    assert.ok(gateContent.includes('critical'), 'Should mention critical severity');
    assert.ok(gateContent.includes('Force push blocked'), 'Should include description');

    const fm = parseFrontmatter(gateContent);
    assert.equal(fm.type, 'gate');
    assert.equal(fm.action, 'block');
  } finally {
    cleanDir(tmpDir);
  }
});

test('exportGates: handles missing config file gracefully', () => {
  const tmpDir = makeTmpDir();
  try {
    const result = exportGates(path.join(tmpDir, 'nonexistent.json'), path.join(tmpDir, 'out'));
    assert.equal(result.exported, 0);
  } finally {
    cleanDir(tmpDir);
  }
});

// ---------------------------------------------------------------------------
// Tests: exportContextFsPacks
// ---------------------------------------------------------------------------

test('exportContextFsPacks: reads provenance and creates pack notes', () => {
  const tmpDir = makeTmpDir();
  const feedbackDir = path.join(tmpDir, 'feedback');
  const outputDir = path.join(tmpDir, 'output');

  try {
    const provDir = path.join(feedbackDir, 'contextfs', 'provenance');
    appendJSONL(path.join(provDir, 'packs.jsonl'), sampleContextPacks());

    const result = exportContextFsPacks(feedbackDir, outputDir);
    assert.equal(result.exported, 1);
    assert.deepEqual(result.errors, []);

    const packDir = path.join(outputDir, 'Context Packs');
    const files = fs.readdirSync(packDir);
    assert.ok(files.includes('pack_bug_001.md'));

    const content = readFile(path.join(packDir, 'pack_bug_001.md'));
    assert.ok(content.includes('bug-investigation'), 'Should mention template');
    assert.ok(content.includes('Bug identified and fixed'), 'Should include outcome');

    const fm = parseFrontmatter(content);
    assert.equal(fm.packId, 'pack_bug_001');
    assert.equal(fm.template, 'bug-investigation');
  } finally {
    cleanDir(tmpDir);
  }
});

test('exportContextFsPacks: handles missing provenance dir gracefully', () => {
  const tmpDir = makeTmpDir();
  try {
    const result = exportContextFsPacks(path.join(tmpDir, 'nonexistent'), path.join(tmpDir, 'out'));
    assert.equal(result.exported, 0);
    assert.deepEqual(result.errors, []);
  } finally {
    cleanDir(tmpDir);
  }
});

// ---------------------------------------------------------------------------
// Tests: exportLessons
// ---------------------------------------------------------------------------

test('exportLessons: identifies promoted lessons and creates notes', () => {
  const tmpDir = makeTmpDir();
  const feedbackDir = path.join(tmpDir, 'feedback');
  const outputDir = path.join(tmpDir, 'output');

  try {
    appendJSONL(path.join(feedbackDir, 'feedback-log.jsonl'), sampleFeedbackEntries());
    appendJSONL(path.join(feedbackDir, 'memory-log.jsonl'), sampleMemoryEntries());

    const result = exportLessons(feedbackDir, outputDir);
    // learning + error memories with content = promoted lessons
    assert.ok(result.exported >= 2, 'Should export at least 2 lessons');
    assert.deepEqual(result.errors, []);

    const lessonsDir = path.join(outputDir, 'Lessons');
    const files = fs.readdirSync(lessonsDir);
    assert.ok(files.includes('Lessons Index.md'), 'Should create lessons index');

    // Check index has wiki-links
    const indexContent = readFile(path.join(lessonsDir, 'Lessons Index.md'));
    assert.ok(indexContent.includes('[[Lessons/'), 'Index should have wiki-links');

    // Check a lesson file
    const lessonFile = files.find((f) => f !== 'Lessons Index.md');
    assert.ok(lessonFile, 'Should have at least one lesson file');
    const content = readFile(path.join(lessonsDir, lessonFile));
    const fm = parseFrontmatter(content);
    assert.equal(fm.promoted, true);
  } finally {
    cleanDir(tmpDir);
  }
});

// ---------------------------------------------------------------------------
// Tests: exportAll
// ---------------------------------------------------------------------------

test('exportAll: orchestrates all exports and creates master index', () => {
  const tmpDir = makeTmpDir();
  const feedbackDir = path.join(tmpDir, 'feedback');
  const outputDir = path.join(tmpDir, 'output');
  const gatesConfig = path.join(tmpDir, 'gates.json');

  try {
    appendJSONL(path.join(feedbackDir, 'feedback-log.jsonl'), sampleFeedbackEntries());
    appendJSONL(path.join(feedbackDir, 'memory-log.jsonl'), sampleMemoryEntries());
    fs.mkdirSync(feedbackDir, { recursive: true });
    fs.writeFileSync(path.join(feedbackDir, 'prevention-rules.md'), samplePreventionRules());
    fs.writeFileSync(gatesConfig, JSON.stringify(sampleGatesConfig()), 'utf-8');

    const provDir = path.join(feedbackDir, 'contextfs', 'provenance');
    appendJSONL(path.join(provDir, 'packs.jsonl'), sampleContextPacks());

    const stats = exportAll({
      feedbackDir,
      outputDir,
      gatesConfigPath: gatesConfig,
      includeIndex: true,
    });

    assert.equal(stats.feedback, 2);
    assert.equal(stats.memories, 2);
    assert.ok(stats.rules >= 2);
    assert.equal(stats.gates, 2);
    assert.equal(stats.packs, 1);
    assert.ok(stats.lessons >= 2);
    assert.deepEqual(stats.errors, []);

    // Master index
    const masterIndex = path.join(outputDir, 'ThumbGate.md');
    assert.ok(fs.existsSync(masterIndex), 'Master index should exist');
    const content = readFile(masterIndex);
    assert.ok(content.includes('Export Summary'), 'Should have summary');
    assert.ok(content.includes('Feedback'), 'Should mention feedback');
    assert.ok(content.includes('[[Rules/Prevention Rules Index]]'), 'Should link to rules index');
    assert.ok(content.includes('[[Gates/Gates Index]]'), 'Should link to gates index');
    assert.ok(content.includes('[[Lessons/Lessons Index]]'), 'Should link to lessons index');
  } finally {
    cleanDir(tmpDir);
  }
});

test('exportAll: handles empty data gracefully', () => {
  const tmpDir = makeTmpDir();
  const feedbackDir = path.join(tmpDir, 'empty-feedback');
  const outputDir = path.join(tmpDir, 'output');

  try {
    fs.mkdirSync(feedbackDir, { recursive: true });

    const stats = exportAll({
      feedbackDir,
      outputDir,
      gatesConfigPath: path.join(tmpDir, 'nonexistent-gates.json'),
      includeIndex: true,
    });

    assert.equal(stats.feedback, 0);
    assert.equal(stats.memories, 0);
    assert.equal(stats.rules, 0);
    assert.equal(stats.gates, 0);
    assert.equal(stats.packs, 0);
    assert.equal(stats.lessons, 0);

    // Master index should still be created
    assert.ok(fs.existsSync(path.join(outputDir, 'ThumbGate.md')));
  } finally {
    cleanDir(tmpDir);
  }
});

// ---------------------------------------------------------------------------
// Tests: YAML frontmatter validity
// ---------------------------------------------------------------------------

test('YAML frontmatter: properly escapes strings with colons', () => {
  const tmpDir = makeTmpDir();
  const feedbackDir = path.join(tmpDir, 'feedback');
  const outputDir = path.join(tmpDir, 'output');

  try {
    appendJSONL(path.join(feedbackDir, 'feedback-log.jsonl'), [
      {
        id: 'fb_colon',
        signal: 'negative',
        context: 'Error: something went wrong: details here',
        whatWentWrong: 'Module: failed to load',
        tags: ['error:handling'],
        timestamp: '2026-03-20T10:00:00.000Z',
      },
    ]);
    const result = exportFeedbackLog(feedbackDir, outputDir);
    assert.equal(result.exported, 1);

    const files = fs.readdirSync(path.join(outputDir, 'Feedback'));
    const content = readFile(path.join(outputDir, 'Feedback', files[0]));

    // Title with colons should be wrapped in quotes in frontmatter
    const fmBlock = content.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(fmBlock, 'Should have frontmatter block');
    const titleLine = fmBlock[1].split('\n').find((l) => l.startsWith('title:'));
    assert.ok(titleLine, 'Should have title line');
    // The value should be quoted because it contains colons
    assert.ok(titleLine.includes('"'), 'Title with colons should be quoted');
  } finally {
    cleanDir(tmpDir);
  }
});

test('YAML frontmatter: all frontmatter blocks are parseable', () => {
  const tmpDir = makeTmpDir();
  const feedbackDir = path.join(tmpDir, 'feedback');
  const outputDir = path.join(tmpDir, 'output');
  const gatesConfig = path.join(tmpDir, 'gates.json');

  try {
    appendJSONL(path.join(feedbackDir, 'feedback-log.jsonl'), sampleFeedbackEntries());
    appendJSONL(path.join(feedbackDir, 'memory-log.jsonl'), sampleMemoryEntries());
    fs.mkdirSync(feedbackDir, { recursive: true });
    fs.writeFileSync(path.join(feedbackDir, 'prevention-rules.md'), samplePreventionRules());
    fs.writeFileSync(gatesConfig, JSON.stringify(sampleGatesConfig()), 'utf-8');

    exportAll({ feedbackDir, outputDir, gatesConfigPath: gatesConfig, includeIndex: true });

    // Walk all .md files and verify frontmatter
    function walkDir(dir) {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          walkDir(fullPath);
        } else if (item.name.endsWith('.md')) {
          const content = readFile(fullPath);
          assert.ok(content.startsWith('---\n'), `File ${item.name} should start with frontmatter`);
          assert.ok(content.includes('\n---\n'), `File ${item.name} should have closing frontmatter`);
          const fm = parseFrontmatter(content);
          assert.ok(fm.title || fm.packId, `File ${item.name} should have title or packId in frontmatter`);
        }
      }
    }
    walkDir(outputDir);
  } finally {
    cleanDir(tmpDir);
  }
});

// ---------------------------------------------------------------------------
// Tests: Wiki-links correctness
// ---------------------------------------------------------------------------

test('Wiki-links: use correct [[note-name]] format', () => {
  const tmpDir = makeTmpDir();
  const feedbackDir = path.join(tmpDir, 'feedback');
  const outputDir = path.join(tmpDir, 'output');

  try {
    appendJSONL(path.join(feedbackDir, 'memory-log.jsonl'), sampleMemoryEntries());
    exportMemoryLog(feedbackDir, outputDir);

    const memDir = path.join(outputDir, 'Memories');
    const files = fs.readdirSync(memDir);

    for (const file of files) {
      const content = readFile(path.join(memDir, file));
      // Find all wiki-links
      const links = content.match(/\[\[.*?\]\]/g) || [];
      for (const link of links) {
        assert.ok(link.startsWith('[['), 'Wiki-link should start with [[');
        assert.ok(link.endsWith(']]'), 'Wiki-link should end with ]]');
        const name = link.slice(2, -2);
        assert.ok(name.length > 0, 'Wiki-link name should not be empty');
        assert.ok(!name.includes('[['), 'Wiki-link name should not contain nested [[');
      }
    }
  } finally {
    cleanDir(tmpDir);
  }
});

// ---------------------------------------------------------------------------
// Tests: CLI integration
// ---------------------------------------------------------------------------

test('CLI: obsidian-export command is wired in cli.js', () => {
  const cliSource = fs.readFileSync(CLI, 'utf-8');
  assert.ok(cliSource.includes("case 'obsidian-export'"), 'CLI should have obsidian-export case');
  assert.ok(cliSource.includes('obsidianExport'), 'CLI should reference obsidianExport function');
});

test('CLI: help output includes obsidian-export', () => {
  const result = spawnSync(process.execPath, [CLI, 'help'], { encoding: 'utf-8' });
  assert.equal(result.status, 0);
  assert.ok(
    result.stdout.includes('obsidian-export') || result.stderr.includes('obsidian-export'),
    'Help output should mention obsidian-export'
  );
});

// ---------------------------------------------------------------------------
// Tests: Idempotent re-export
// ---------------------------------------------------------------------------

test('Idempotent: running export twice produces same output', () => {
  const tmpDir = makeTmpDir();
  const feedbackDir = path.join(tmpDir, 'feedback');
  const outputDir1 = path.join(tmpDir, 'output1');
  const outputDir2 = path.join(tmpDir, 'output2');
  const gatesConfig = path.join(tmpDir, 'gates.json');

  try {
    appendJSONL(path.join(feedbackDir, 'feedback-log.jsonl'), sampleFeedbackEntries());
    appendJSONL(path.join(feedbackDir, 'memory-log.jsonl'), sampleMemoryEntries());
    fs.mkdirSync(feedbackDir, { recursive: true });
    fs.writeFileSync(path.join(feedbackDir, 'prevention-rules.md'), samplePreventionRules());
    fs.writeFileSync(gatesConfig, JSON.stringify(sampleGatesConfig()), 'utf-8');

    const stats1 = exportAll({ feedbackDir, outputDir: outputDir1, gatesConfigPath: gatesConfig, includeIndex: false });
    const stats2 = exportAll({ feedbackDir, outputDir: outputDir2, gatesConfigPath: gatesConfig, includeIndex: false });

    assert.equal(stats1.feedback, stats2.feedback);
    assert.equal(stats1.memories, stats2.memories);
    assert.equal(stats1.rules, stats2.rules);
    assert.equal(stats1.gates, stats2.gates);
    assert.equal(stats1.lessons, stats2.lessons);

    // Compare file listings
    function listFiles(dir) {
      const result = [];
      function walk(d) {
        for (const item of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, item.name);
          if (item.isDirectory()) walk(p);
          else result.push(path.relative(dir, p));
        }
      }
      walk(dir);
      return result.sort();
    }

    const files1 = listFiles(outputDir1);
    const files2 = listFiles(outputDir2);
    assert.deepEqual(files1, files2, 'Both exports should produce identical file sets');

    // Compare content of each file (excluding timestamp-sensitive master index)
    for (const file of files1) {
      const c1 = readFile(path.join(outputDir1, file));
      const c2 = readFile(path.join(outputDir2, file));
      assert.equal(c1, c2, `File ${file} should be identical across exports`);
    }
  } finally {
    cleanDir(tmpDir);
  }
});
