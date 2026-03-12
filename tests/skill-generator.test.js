// tests/skill-generator.test.js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  generateSkills,
  generateSkillFromCluster,
} = require('../scripts/skill-generator');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-skill-gen-test-'));
}

function appendJSONL(filePath, record) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
}

function readFeedbackLog(tmpDir) {
  return path.join(tmpDir, 'feedback-log.jsonl');
}

function makeNegativeEntry(tags, overrides = {}) {
  return {
    signal: 'down',
    context: 'Agent made an error',
    whatWentWrong: 'Skipped verification',
    whatToChange: 'Always verify before claiming done',
    tags,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makePositiveEntry(tags, overrides = {}) {
  return {
    signal: 'up',
    context: 'Agent did the right thing',
    whatWorked: 'Ran tests before committing',
    tags,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// -- generateSkills with empty feedback log --

test('generateSkills: empty feedback log returns empty array', (t) => {
  const tmpDir = makeTmpDir();
  const logFile = readFeedbackLog(tmpDir);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, '');
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.RLHF_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  const result = generateSkills({ feedbackDir: tmpDir });
  assert.ok(Array.isArray(result), 'result should be an array');
  assert.strictEqual(result.length, 0, 'empty log should produce no skills');
});

// -- generateSkills with fewer than 3 entries per cluster --

test('generateSkills: fewer than 3 entries per cluster returns empty array', (t) => {
  const tmpDir = makeTmpDir();
  const logFile = readFeedbackLog(tmpDir);
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.RLHF_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  // Only 2 negative entries with overlapping tags — below threshold
  appendJSONL(logFile, makeNegativeEntry(['testing', 'verification']));
  appendJSONL(logFile, makeNegativeEntry(['testing', 'verification']));

  const result = generateSkills({ feedbackDir: tmpDir });
  assert.ok(Array.isArray(result), 'result should be an array');
  assert.strictEqual(result.length, 0, 'clusters below threshold should produce no skills');
});

// -- generateSkills with 3+ negative entries sharing tags --

test('generateSkills: 3+ negative entries sharing tags generates skill file', (t) => {
  const tmpDir = makeTmpDir();
  const logFile = readFeedbackLog(tmpDir);
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.RLHF_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  appendJSONL(logFile, makeNegativeEntry(['testing', 'verification'], { whatWentWrong: 'Skipped tests' }));
  appendJSONL(logFile, makeNegativeEntry(['testing', 'verification'], { whatWentWrong: 'No test output' }));
  appendJSONL(logFile, makeNegativeEntry(['testing', 'verification'], { whatWentWrong: 'Tests not run' }));

  const result = generateSkills({ feedbackDir: tmpDir });
  assert.ok(result.length >= 1, 'should generate at least one skill');

  const generatedDir = path.join(tmpDir, 'generated-skills');
  assert.ok(fs.existsSync(generatedDir), 'generated-skills directory should exist');

  const files = fs.readdirSync(generatedDir).filter(f => f.endsWith('.md'));
  assert.ok(files.length >= 1, 'should write at least one SKILL.md file');
});

// -- Generated SKILL.md contains correct frontmatter --

test('generated SKILL.md contains correct frontmatter (name, description)', (t) => {
  const tmpDir = makeTmpDir();
  const logFile = readFeedbackLog(tmpDir);
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.RLHF_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  appendJSONL(logFile, makeNegativeEntry(['testing', 'verification']));
  appendJSONL(logFile, makeNegativeEntry(['testing', 'verification']));
  appendJSONL(logFile, makeNegativeEntry(['testing', 'verification']));

  const result = generateSkills({ feedbackDir: tmpDir });
  assert.ok(result.length >= 1, 'should generate at least one skill');

  const generatedDir = path.join(tmpDir, 'generated-skills');
  const files = fs.readdirSync(generatedDir).filter(f => f.endsWith('.md'));
  const content = fs.readFileSync(path.join(generatedDir, files[0]), 'utf8');

  assert.match(content, /^---/m, 'should start with frontmatter delimiter');
  assert.match(content, /name:/i, 'frontmatter should contain name');
  assert.match(content, /description:/i, 'frontmatter should contain description');
});

// -- Generated SKILL.md contains DO rules from positive feedback --

test('generated SKILL.md contains DO rules from positive feedback', (t) => {
  const tmpDir = makeTmpDir();
  const logFile = readFeedbackLog(tmpDir);
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.RLHF_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  // 3 negative to meet threshold
  appendJSONL(logFile, makeNegativeEntry(['testing', 'verification']));
  appendJSONL(logFile, makeNegativeEntry(['testing', 'verification']));
  appendJSONL(logFile, makeNegativeEntry(['testing', 'verification']));
  // Positive entries with same tags to generate DO rules
  appendJSONL(logFile, makePositiveEntry(['testing', 'verification'], { whatWorked: 'Ran full test suite before commit' }));
  appendJSONL(logFile, makePositiveEntry(['testing', 'verification'], { whatWorked: 'Included test output as evidence' }));

  const result = generateSkills({ feedbackDir: tmpDir });
  assert.ok(result.length >= 1, 'should generate at least one skill');

  const generatedDir = path.join(tmpDir, 'generated-skills');
  const files = fs.readdirSync(generatedDir).filter(f => f.endsWith('.md'));
  const content = fs.readFileSync(path.join(generatedDir, files[0]), 'utf8');

  assert.match(content, /DO/i, 'should contain DO rules section');
});

// -- Generated SKILL.md contains INSTEAD rules from negative patterns --

test('generated SKILL.md contains INSTEAD rules from negative patterns', (t) => {
  const tmpDir = makeTmpDir();
  const logFile = readFeedbackLog(tmpDir);
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.RLHF_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  appendJSONL(logFile, makeNegativeEntry(['testing', 'verification'], { whatToChange: 'Run tests before claiming done' }));
  appendJSONL(logFile, makeNegativeEntry(['testing', 'verification'], { whatToChange: 'Show test output as proof' }));
  appendJSONL(logFile, makeNegativeEntry(['testing', 'verification'], { whatToChange: 'Never skip test step' }));

  const result = generateSkills({ feedbackDir: tmpDir });
  assert.ok(result.length >= 1, 'should generate at least one skill');

  const generatedDir = path.join(tmpDir, 'generated-skills');
  const files = fs.readdirSync(generatedDir).filter(f => f.endsWith('.md'));
  const content = fs.readFileSync(path.join(generatedDir, files[0]), 'utf8');

  assert.match(content, /INSTEAD/i, 'should contain INSTEAD rules section');
});

// -- Generated SKILL.md contains evidence section with counts --

test('generated SKILL.md contains evidence section with counts', (t) => {
  const tmpDir = makeTmpDir();
  const logFile = readFeedbackLog(tmpDir);
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.RLHF_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  appendJSONL(logFile, makeNegativeEntry(['testing', 'verification']));
  appendJSONL(logFile, makeNegativeEntry(['testing', 'verification']));
  appendJSONL(logFile, makeNegativeEntry(['testing', 'verification']));
  appendJSONL(logFile, makeNegativeEntry(['testing', 'verification']));

  const result = generateSkills({ feedbackDir: tmpDir });
  assert.ok(result.length >= 1, 'should generate at least one skill');

  const generatedDir = path.join(tmpDir, 'generated-skills');
  const files = fs.readdirSync(generatedDir).filter(f => f.endsWith('.md'));
  const content = fs.readFileSync(path.join(generatedDir, files[0]), 'utf8');

  assert.match(content, /evidence/i, 'should contain evidence section');
  // Should reference the count of entries in the cluster
  assert.match(content, /[34]/, 'should contain the entry count');
});

// -- Multiple clusters generate multiple skill files --

test('multiple clusters generate multiple skill files', (t) => {
  const tmpDir = makeTmpDir();
  const logFile = readFeedbackLog(tmpDir);
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.RLHF_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  // Cluster 1: testing/verification
  appendJSONL(logFile, makeNegativeEntry(['testing', 'verification']));
  appendJSONL(logFile, makeNegativeEntry(['testing', 'verification']));
  appendJSONL(logFile, makeNegativeEntry(['testing', 'verification']));

  // Cluster 2: security/secrets (distinct tag set)
  appendJSONL(logFile, makeNegativeEntry(['security', 'secrets'], { whatWentWrong: 'Committed .env file' }));
  appendJSONL(logFile, makeNegativeEntry(['security', 'secrets'], { whatWentWrong: 'Leaked API key' }));
  appendJSONL(logFile, makeNegativeEntry(['security', 'secrets'], { whatWentWrong: 'Hardcoded credentials' }));

  const result = generateSkills({ feedbackDir: tmpDir });
  assert.ok(result.length >= 2, `should generate at least 2 skills, got ${result.length}`);

  const generatedDir = path.join(tmpDir, 'generated-skills');
  const files = fs.readdirSync(generatedDir).filter(f => f.endsWith('.md'));
  assert.ok(files.length >= 2, `should write at least 2 SKILL.md files, got ${files.length}`);
});

// -- Skill files written to generated-skills/ directory --

test('skill files are written to generated-skills/ directory', (t) => {
  const tmpDir = makeTmpDir();
  const logFile = readFeedbackLog(tmpDir);
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.RLHF_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  appendJSONL(logFile, makeNegativeEntry(['git', 'workflow']));
  appendJSONL(logFile, makeNegativeEntry(['git', 'workflow']));
  appendJSONL(logFile, makeNegativeEntry(['git', 'workflow']));

  const result = generateSkills({ feedbackDir: tmpDir });
  assert.ok(result.length >= 1, 'should generate at least one skill');

  const generatedDir = path.join(tmpDir, 'generated-skills');
  assert.ok(fs.existsSync(generatedDir), 'generated-skills/ directory should exist');

  const files = fs.readdirSync(generatedDir);
  for (const file of files) {
    const fullPath = path.join(generatedDir, file);
    assert.ok(fullPath.startsWith(generatedDir), 'all output files should be inside generated-skills/');
    assert.ok(file.endsWith('.md'), `skill file should be .md, got: ${file}`);
    const stat = fs.statSync(fullPath);
    assert.ok(stat.size > 0, `skill file ${file} should not be empty`);
  }
});

// -- generateSkillFromCluster: produces valid markdown from a cluster object --

test('generateSkillFromCluster: produces valid SKILL.md content from cluster', () => {
  const cluster = {
    tags: ['testing', 'verification'],
    entries: [
      makeNegativeEntry(['testing', 'verification'], { whatWentWrong: 'Skipped tests', whatToChange: 'Run tests first' }),
      makeNegativeEntry(['testing', 'verification'], { whatWentWrong: 'No output', whatToChange: 'Show evidence' }),
      makeNegativeEntry(['testing', 'verification'], { whatWentWrong: 'Claimed done early', whatToChange: 'Verify before claiming' }),
    ],
    positiveEntries: [
      makePositiveEntry(['testing', 'verification'], { whatWorked: 'Ran full test suite' }),
    ],
  };

  const content = generateSkillFromCluster(cluster);
  assert.strictEqual(typeof content, 'string', 'should return a string');
  assert.ok(content.length > 0, 'should not be empty');
  assert.match(content, /^---/m, 'should contain frontmatter');
  assert.match(content, /name:/i, 'should have name in frontmatter');
  assert.match(content, /description:/i, 'should have description in frontmatter');
  assert.match(content, /DO/i, 'should have DO rules');
  assert.match(content, /INSTEAD/i, 'should have INSTEAD rules');
});
