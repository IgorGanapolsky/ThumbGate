#!/usr/bin/env node
'use strict';

/**
 * Memory Migration + Health Check — fixes the Claude Code memory limits
 * that Mem0 exposed (200-line cap, 5 files/turn, no embeddings, silent deletion).
 *
 * 1. checkMemoryHealth() — scans MEMORY.md, warns if approaching 200-line cap
 * 2. migrateClaudeMemory() — imports MEMORY.md files into ThumbGate's SQLite lesson DB
 * 3. generateComparisonData() — data for "Claude Code Memory vs ThumbGate" page
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_MEMORY_LINE_CAP = 200;
const CLAUDE_FILES_PER_TURN = 5;

// ---------------------------------------------------------------------------
// 1. Memory Health Check
// ---------------------------------------------------------------------------

/**
 * Find all MEMORY.md files in Claude Code's project memory directories.
 */
function findMemoryFiles() {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  const results = [];

  if (!fs.existsSync(claudeDir)) return results;

  function walk(dir, depth) {
    if (depth > 5) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, depth + 1);
        } else if (entry.name === 'MEMORY.md') {
          results.push(full);
        }
      }
    } catch { /* permission errors */ }
  }

  walk(claudeDir, 0);
  return results;
}

/**
 * Parse a MEMORY.md file into structured entries.
 * Each entry is a line starting with "- " in MEMORY.md.
 */
function parseMemoryFile(filePath) {
  if (!fs.existsSync(filePath)) return { path: filePath, lines: 0, entries: [], linkedFiles: [] };
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const entries = [];
  const linkedFiles = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      const linkMatch = trimmed.match(/\[([^\]]+)\]\(([^)]+)\)/);
      const entry = {
        text: trimmed.slice(2),
        hasLink: !!linkMatch,
        linkTitle: linkMatch ? linkMatch[1] : null,
        linkFile: linkMatch ? linkMatch[2] : null,
      };
      entries.push(entry);
      if (linkMatch) linkedFiles.push(linkMatch[2]);
    }
  }

  return { path: filePath, lines: lines.length, entries, linkedFiles };
}

/**
 * Read a linked memory file (the actual memory content behind MEMORY.md pointers).
 */
function readLinkedMemoryFile(memoryDir, relativePath) {
  const fullPath = path.join(memoryDir, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    // Parse frontmatter
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (fmMatch) {
      const fm = {};
      for (const line of fmMatch[1].split('\n')) {
        const [key, ...val] = line.split(':');
        if (key && val.length) fm[key.trim()] = val.join(':').trim();
      }
      return { path: relativePath, frontmatter: fm, body: fmMatch[2].trim(), raw: content };
    }
    return { path: relativePath, frontmatter: {}, body: content.trim(), raw: content };
  } catch { return null; }
}

/**
 * Check health of all Claude Code memory files.
 * Returns warnings, risk level, and migration recommendations.
 */
function checkMemoryHealth() {
  const memoryFiles = findMemoryFiles();
  const results = [];

  for (const filePath of memoryFiles) {
    const parsed = parseMemoryFile(filePath);
    const memoryDir = path.dirname(filePath);
    const warnings = [];
    let riskLevel = 'healthy';

    // Check line cap
    if (parsed.lines >= CLAUDE_MEMORY_LINE_CAP) {
      warnings.push({ type: 'line_cap_exceeded', message: `${parsed.lines} lines — exceeds ${CLAUDE_MEMORY_LINE_CAP}-line cap. Memories are being silently deleted.`, severity: 'critical' });
      riskLevel = 'critical';
    } else if (parsed.lines >= CLAUDE_MEMORY_LINE_CAP * 0.8) {
      warnings.push({ type: 'line_cap_approaching', message: `${parsed.lines}/${CLAUDE_MEMORY_LINE_CAP} lines — approaching cap. Memories will be deleted soon.`, severity: 'warning' });
      riskLevel = 'warning';
    }

    // Check linked files
    let linkedFilesFound = 0;
    let linkedFilesMissing = 0;
    for (const linkedFile of parsed.linkedFiles) {
      const full = path.join(memoryDir, linkedFile);
      if (fs.existsSync(full)) linkedFilesFound++; else linkedFilesMissing++;
    }
    if (linkedFilesMissing > 0) {
      warnings.push({ type: 'missing_linked_files', message: `${linkedFilesMissing} linked memory files not found on disk`, severity: 'warning' });
    }

    // Check files-per-turn limit
    if (parsed.linkedFiles.length > CLAUDE_FILES_PER_TURN) {
      warnings.push({ type: 'files_per_turn_exceeded', message: `${parsed.linkedFiles.length} linked files but Claude Code reads max ${CLAUDE_FILES_PER_TURN} per turn`, severity: 'warning' });
      if (riskLevel === 'healthy') riskLevel = 'warning';
    }

    results.push({
      path: filePath,
      project: path.basename(path.dirname(memoryDir)),
      lines: parsed.lines,
      entryCount: parsed.entries.length,
      linkedFiles: parsed.linkedFiles.length,
      linkedFilesFound,
      linkedFilesMissing,
      riskLevel,
      warnings,
      cap: CLAUDE_MEMORY_LINE_CAP,
      usagePercent: Math.round((parsed.lines / CLAUDE_MEMORY_LINE_CAP) * 100),
    });
  }

  return {
    totalFiles: results.length,
    criticalCount: results.filter((r) => r.riskLevel === 'critical').length,
    warningCount: results.filter((r) => r.riskLevel === 'warning').length,
    healthyCount: results.filter((r) => r.riskLevel === 'healthy').length,
    files: results,
    checkedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 2. Memory Migration
// ---------------------------------------------------------------------------

/**
 * Migrate a Claude Code MEMORY.md (+ linked files) into ThumbGate lessons.
 * Returns { migrated, skipped, errors }.
 */
function migrateClaudeMemory(memoryFilePath) {
  const parsed = parseMemoryFile(memoryFilePath);
  const memoryDir = path.dirname(memoryFilePath);
  const migrated = [];
  const skipped = [];
  const errors = [];

  let createLesson;
  try { createLesson = require('./lesson-inference').createLesson; } catch (e) { return { migrated: [], skipped: [], errors: [{ message: `lesson-inference not available: ${e.message}` }] }; }

  for (const entry of parsed.entries) {
    try {
      // Read linked file if available
      let fullContent = entry.text;
      let memoryType = 'unknown';
      let tags = ['migrated-from-claude-memory'];

      if (entry.hasLink && entry.linkFile) {
        const linked = readLinkedMemoryFile(memoryDir, entry.linkFile);
        if (linked) {
          fullContent = linked.body || entry.text;
          memoryType = (linked.frontmatter && linked.frontmatter.type) || 'unknown';
          tags.push(memoryType);
        }
      }

      // Skip if too short to be useful
      if (fullContent.length < 10) {
        skipped.push({ entry: entry.text, reason: 'too short' });
        continue;
      }

      const lesson = createLesson({
        signal: memoryType === 'feedback' ? 'negative' : 'positive',
        inferredLesson: fullContent.slice(0, 500),
        confidence: 50,
        tags,
        metadata: { source: 'claude-memory-migration', originalFile: memoryFilePath, memoryType },
      });

      migrated.push({ entryText: entry.text.slice(0, 100), lessonId: lesson.id, memoryType });
    } catch (err) {
      errors.push({ entry: entry.text.slice(0, 100), message: err.message });
    }
  }

  return {
    sourceFile: memoryFilePath,
    totalEntries: parsed.entries.length,
    migrated,
    migratedCount: migrated.length,
    skipped,
    skippedCount: skipped.length,
    errors,
    errorCount: errors.length,
    migratedAt: new Date().toISOString(),
  };
}

/**
 * Migrate ALL Claude Code memory files found on disk.
 */
function migrateAllMemory() {
  const memoryFiles = findMemoryFiles();
  const results = memoryFiles.map(migrateClaudeMemory);
  const totalMigrated = results.reduce((s, r) => s + r.migratedCount, 0);
  const totalSkipped = results.reduce((s, r) => s + r.skippedCount, 0);
  const totalErrors = results.reduce((s, r) => s + r.errorCount, 0);
  return { files: results, totalFiles: results.length, totalMigrated, totalSkipped, totalErrors, migratedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// 3. Comparison Data
// ---------------------------------------------------------------------------

/**
 * Generate data for "Claude Code Memory vs ThumbGate" comparison.
 */
function generateComparisonData() {
  const health = checkMemoryHealth();
  const feedbackDir = process.env.THUMBGATE_FEEDBACK_DIR || path.join(process.cwd(), '.thumbgate');
  let lessonCount = 0;
  const lessonsPath = path.join(feedbackDir, 'lessons-index.jsonl');
  if (fs.existsSync(lessonsPath)) {
    lessonCount = fs.readFileSync(lessonsPath, 'utf-8').trim().split('\n').filter(Boolean).length;
  }

  return {
    claudeCode: {
      indexLineCap: CLAUDE_MEMORY_LINE_CAP,
      filesPerTurn: CLAUDE_FILES_PER_TURN,
      hasEmbeddings: false,
      silentDeletion: true,
      searchMethod: 'flat text substring match',
      memoryFiles: health.totalFiles,
      atRisk: health.criticalCount + health.warningCount,
    },
    thumbgate: {
      indexLineCap: 'unlimited (SQLite+FTS5)',
      filesPerTurn: 'unlimited (MCP recall in single tool call)',
      hasEmbeddings: true,
      silentDeletion: false,
      searchMethod: 'FTS5 + LanceDB vectors + Thompson Sampling + multi-hop retrieval',
      lessons: lessonCount,
      features: ['prevention rules', 'pre-action checks', 'org dashboard', 'DPO export', 'skill packs', 'hallucination detection', 'PII scanning'],
    },
    recommendation: health.criticalCount > 0
      ? 'URGENT: memories are being silently deleted. Migrate now with: npx thumbgate migrate'
      : health.warningCount > 0
        ? 'WARNING: approaching memory cap. Migrate soon to avoid silent deletion.'
        : 'Healthy for now, but ThumbGate offers unlimited storage + vector search + gates.',
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  CLAUDE_MEMORY_LINE_CAP, CLAUDE_FILES_PER_TURN,
  findMemoryFiles, parseMemoryFile, readLinkedMemoryFile,
  checkMemoryHealth, migrateClaudeMemory, migrateAllMemory,
  generateComparisonData,
};
