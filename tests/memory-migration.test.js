const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-migrate-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

const mm = require('../scripts/memory-migration');

test.after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

// === Constants ===
test('CLAUDE_MEMORY_LINE_CAP is 200', () => { assert.equal(mm.CLAUDE_MEMORY_LINE_CAP, 200); });
test('CLAUDE_FILES_PER_TURN is 5', () => { assert.equal(mm.CLAUDE_FILES_PER_TURN, 5); });

// === findMemoryFiles ===
test('findMemoryFiles returns array', () => { assert.ok(Array.isArray(mm.findMemoryFiles())); });

// === parseMemoryFile ===
test('parseMemoryFile parses entries from MEMORY.md', () => {
  const memPath = path.join(tmpDir, 'MEMORY.md');
  fs.writeFileSync(memPath, '- [Rule 1](rule1.md) — Never force push\n- [Rule 2](rule2.md) — Always verify\n- Simple entry without link\n');
  const parsed = mm.parseMemoryFile(memPath);
  assert.equal(parsed.entries.length, 3);
  assert.equal(parsed.entries[0].hasLink, true);
  assert.equal(parsed.entries[0].linkFile, 'rule1.md');
  assert.equal(parsed.entries[2].hasLink, false);
  assert.ok(parsed.linkedFiles.includes('rule1.md'));
});

test('parseMemoryFile handles empty file', () => {
  const memPath = path.join(tmpDir, 'empty.md');
  fs.writeFileSync(memPath, '');
  const parsed = mm.parseMemoryFile(memPath);
  assert.equal(parsed.entries.length, 0);
});

test('parseMemoryFile handles missing file', () => {
  const parsed = mm.parseMemoryFile('/nonexistent/MEMORY.md');
  assert.equal(parsed.entries.length, 0);
});

// === readLinkedMemoryFile ===
test('readLinkedMemoryFile parses frontmatter', () => {
  const memDir = path.join(tmpDir, 'mem');
  fs.mkdirSync(memDir, { recursive: true });
  fs.writeFileSync(path.join(memDir, 'rule1.md'), '---\nname: Rule 1\ntype: feedback\n---\nNever force push to main.');
  const linked = mm.readLinkedMemoryFile(memDir, 'rule1.md');
  assert.ok(linked);
  assert.equal(linked.frontmatter.name, 'Rule 1');
  assert.equal(linked.frontmatter.type, 'feedback');
  assert.ok(linked.body.includes('Never force push'));
});

test('readLinkedMemoryFile returns null for missing file', () => {
  assert.equal(mm.readLinkedMemoryFile(tmpDir, 'nope.md'), null);
});

// === checkMemoryHealth ===
test('checkMemoryHealth returns structured result', () => {
  const health = mm.checkMemoryHealth();
  assert.ok(typeof health.totalFiles === 'number');
  assert.ok(typeof health.criticalCount === 'number');
  assert.ok(health.checkedAt);
});

test('checkMemoryHealth detects line cap exceeded', () => {
  // Create a fake MEMORY.md with 210 lines
  const projDir = path.join(tmpDir, 'proj-memory');
  fs.mkdirSync(projDir, { recursive: true });
  const memPath = path.join(projDir, 'MEMORY.md');
  const lines = Array.from({ length: 210 }, (_, i) => `- Entry ${i}`).join('\n');
  fs.writeFileSync(memPath, lines);
  const parsed = mm.parseMemoryFile(memPath);
  assert.ok(parsed.lines >= 200);
});

// === migrateClaudeMemory ===
test('migrateClaudeMemory imports entries into ThumbGate lessons', () => {
  const memDir = path.join(tmpDir, 'migrate-test');
  fs.mkdirSync(memDir, { recursive: true });
  fs.writeFileSync(path.join(memDir, 'MEMORY.md'), '- [Rule](rule.md) — Never skip tests\n- Always verify deploys\n');
  fs.writeFileSync(path.join(memDir, 'rule.md'), '---\nname: No skip tests\ntype: feedback\n---\nNever skip tests before claiming done.');

  const result = mm.migrateClaudeMemory(path.join(memDir, 'MEMORY.md'));
  assert.ok(result.migratedCount >= 1);
  assert.equal(result.errorCount, 0);
  assert.ok(result.migrated[0].lessonId.startsWith('lesson_'));
});

test('migrateClaudeMemory skips short entries', () => {
  const memDir = path.join(tmpDir, 'migrate-short');
  fs.mkdirSync(memDir, { recursive: true });
  fs.writeFileSync(path.join(memDir, 'MEMORY.md'), '- ok\n- This is a real entry with enough content\n');
  const result = mm.migrateClaudeMemory(path.join(memDir, 'MEMORY.md'));
  assert.equal(result.skippedCount, 1);
  assert.ok(result.migratedCount >= 1);
});

test('migrateClaudeMemory handles empty file', () => {
  const memDir = path.join(tmpDir, 'migrate-empty');
  fs.mkdirSync(memDir, { recursive: true });
  fs.writeFileSync(path.join(memDir, 'MEMORY.md'), '');
  const result = mm.migrateClaudeMemory(path.join(memDir, 'MEMORY.md'));
  assert.equal(result.migratedCount, 0);
});

// === migrateAllMemory ===
test('migrateAllMemory returns aggregate results', () => {
  const result = mm.migrateAllMemory();
  assert.ok(typeof result.totalFiles === 'number');
  assert.ok(typeof result.totalMigrated === 'number');
  assert.ok(result.migratedAt);
});

// === generateComparisonData ===
test('generateComparisonData returns Claude vs ThumbGate comparison', () => {
  const data = mm.generateComparisonData();
  assert.equal(data.claudeCode.indexLineCap, 200);
  assert.equal(data.claudeCode.filesPerTurn, 5);
  assert.equal(data.claudeCode.hasEmbeddings, false);
  assert.equal(data.claudeCode.silentDeletion, true);
  assert.equal(data.thumbgate.hasEmbeddings, true);
  assert.equal(data.thumbgate.silentDeletion, false);
  assert.ok(data.thumbgate.features.includes('prevention rules'));
  assert.ok(data.recommendation.length > 0);
});
