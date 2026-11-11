'use strict';

/**
 * project-scope.js — Fixed-schema project scoping and transcript filtering
 * for ThumbGate lesson retrieval and feedback capture.
 *
 * Pattern: Dual-Model MoA & Agentic GraphRAG Playbook (Schema-Constrained Extraction).
 *
 * Principles:
 * 1. Zero private client/project names or usernames in the public codebase.
 * 2. Scope resolution derives strictly from cwd, package.json, and git remote origin.
 * 3. Transport transcript tokens (<task-notification>, <tool-use-id>, etc.) are rejected.
 * 4. Fast cached resolution: avoids spawning git subshells on every tool call (<0.1ms).
 * 5. Unscoped/unknown lessons are excluded from PreToolUse injection unless explicitly global.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const TRANSCRIPT_XML_TAGS = Object.freeze([
  '<task-notification>',
  '</task-notification>',
  '<task-id>',
  '</task-id>',
  '<tool-use-id>',
  '</tool-use-id>',
  '<output-file>',
  '</output-file>',
]);

const GLOBAL_RULE_REGEX = /\b(?:never\s+kill\s+processes|bypass\s+branch\s+protection|git\s+worktree|fail-closed|branch\s+protection)\b/i;

const CWD_CACHE = new Map();
let diskCacheLoaded = false;
let diskCache = {};

function getDiskCachePath() {
  return path.join(os.tmpdir(), 'thumbgate-cwd-scope-cache.json');
}

function loadDiskCache() {
  if (diskCacheLoaded) return diskCache;
  try {
    const cacheFile = getDiskCachePath();
    if (fs.existsSync(cacheFile)) {
      diskCache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) || {};
    }
  } catch {
    diskCache = {};
  }
  diskCacheLoaded = true;
  return diskCache;
}

function saveDiskCache() {
  try {
    const cacheFile = getDiskCachePath();
    fs.writeFileSync(cacheFile, JSON.stringify(diskCache), 'utf8');
  } catch {
    // Non-fatal cache write failure
  }
}

function clearCwdCache() {
  CWD_CACHE.clear();
  diskCache = {};
  diskCacheLoaded = false;
  try {
    const cacheFile = getDiskCachePath();
    if (fs.existsSync(cacheFile)) {
      fs.unlinkSync(cacheFile);
    }
  } catch {
    // Non-fatal
  }
}

const SEPARATORS = ['-', '_'];
const SUFFIX_MARKERS = ['wt', 'poolside', 'branch'];

// Linear-time suffix truncation (no regex backtracking — CodeQL js/polynomial-redos).
function truncateAtMarker(value, marker) {
  let cut = -1;
  for (const pre of SEPARATORS) {
    for (const post of SEPARATORS) {
      const idx = value.indexOf(pre + marker + post);
      if (idx !== -1 && (cut === -1 || idx < cut)) cut = idx;
    }
  }
  return cut === -1 ? value : value.slice(0, cut);
}

function normalizeProjectName(name) {
  if (!name || typeof name !== 'string') return '';
  let cleaned = name.trim().toLowerCase();
  // Strip worktree and branch suffixes like -wt-..., .worktrees, etc.
  for (const marker of SUFFIX_MARKERS) cleaned = truncateAtMarker(cleaned, marker);
  const worktreesIdx = cleaned.indexOf('.worktrees');
  if (worktreesIdx !== -1) cleaned = cleaned.slice(0, worktreesIdx);
  return cleaned;
}

/**
 * Checks if a string or lesson object contains raw transport transcript tokens.
 */
function isTranscriptShaped(input) {
  if (!input) return false;
  if (typeof input === 'string') {
    const lower = input.toLowerCase();
    for (const tag of TRANSCRIPT_XML_TAGS) {
      if (lower.includes(tag.toLowerCase())) return true;
    }
    return /<\s*task-notification\b|<\s*tool-use-id\b|<\s*output-file\b|<\s*task-id\b/i.test(input);
  }

  if (typeof input === 'object') {
    const fields = [
      input.whatWentWrong,
      input.whatToChange,
      input.whatWorked,
      input.title,
      input.content,
      input.context,
      input.rule?.description,
      ...(Array.isArray(input.distillation?.evidence) ? input.distillation.evidence : []),
    ];
    for (const field of fields) {
      if (field && isTranscriptShaped(String(field))) return true;
    }
  }

  return false;
}

/** Prefer fixed absolute git paths (Sonar S4036 — avoid bare PATH lookup). */
function resolveGitBinary() {
  const candidates = [
    process.env.GIT_BINARY,
    '/usr/bin/git',
    '/opt/homebrew/bin/git',
    '/usr/local/bin/git',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return '/usr/bin/git';
}

/**
 * Resolve the project name from a working directory or git root with caching.
 */
function resolveProjectFromCwd(dir, options = {}) {
  const targetDir = dir ? path.resolve(dir) : process.cwd();

  if (options.noCache !== true) {
    if (CWD_CACHE.has(targetDir)) {
      return CWD_CACHE.get(targetDir);
    }
    const dCache = loadDiskCache();
    if (dCache[targetDir]) {
      CWD_CACHE.set(targetDir, dCache[targetDir]);
      return dCache[targetDir];
    }
  }

  let resolved = null;

  // 1. Check nearest package.json first (pure fs, <0.1ms, zero subshell overhead)
  try {
    let curr = targetDir;
    while (curr && curr !== path.dirname(curr)) {
      const pkgPath = path.join(curr, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.name) {
          const pkgName = pkg.name.startsWith('@') ? pkg.name.split('/')[1] : pkg.name;
          resolved = pkgName;
          break;
        }
      }
      curr = path.dirname(curr);
    }
  } catch {
    // fall through
  }

  // 2. Try git remote origin URL
  if (!resolved) {
    try {
      const gitBin = resolveGitBinary();
      const gitOutput = execFileSync(gitBin, ['-C', targetDir, 'config', '--get', 'remote.origin.url'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 1000,
      }).trim();
      if (gitOutput) {
        const match = gitOutput.match(/[/:](\w[-\w]+)\/(\w[-\w]+?)(?:\.git)?$/);
        if (match && match[2]) {
          resolved = match[2];
        } else {
          const slashBase = path.basename(gitOutput.replace(/\.git$/, ''));
          if (slashBase) resolved = slashBase;
        }
      }
    } catch {
      // Fall through
    }
  }

  // 3. Try git top-level
  if (!resolved) {
    try {
      const gitBin = resolveGitBinary();
      const topLevel = execFileSync(gitBin, ['-C', targetDir, 'rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 1000,
      }).trim();
      if (topLevel) {
        resolved = path.basename(topLevel);
      }
    } catch {
      // Fall through
    }
  }

  if (!resolved) {
    resolved = path.basename(targetDir);
  }

  const normalized = normalizeProjectName(resolved) || resolved;

  if (options.noCache !== true) {
    CWD_CACHE.set(targetDir, normalized);
    diskCache[targetDir] = normalized;
    saveDiskCache();
  }

  return normalized;
}

/**
 * Infer the project associated with a lesson from its declared scope, metadata, or tags.
 * Unknown lessons return null (unscoped).
 */
function inferProjectFromLesson(lesson) {
  if (!lesson || typeof lesson !== 'object') return null;

  // 1. Explicit scope or metadata
  const declaredProject = lesson.scope?.projectId || lesson.metadata?.project || lesson.metadata?.repo || lesson.metadata?.repoId;
  if (declaredProject && typeof declaredProject === 'string' && declaredProject !== 'default' && declaredProject !== 'agent') {
    return declaredProject;
  }

  // 2. Check for global rules
  if (
    lesson.shared === true ||
    lesson.scope?.shared === true ||
    lesson.scope === 'global' ||
    lesson.scope?.projectId === 'global' ||
    lesson.metadata?.scope === 'global' ||
    (Array.isArray(lesson.tags) && lesson.tags.includes('global'))
  ) {
    return 'global';
  }

  const texts = [
    lesson.title,
    lesson.content,
    lesson.whatWentWrong,
    lesson.whatToChange,
    lesson.whatWorked,
    lesson.rule?.description,
    lesson.structuredRule?.action?.description,
    ...(Array.isArray(lesson.tags) ? lesson.tags : []),
  ].filter(Boolean).join(' ');

  if (GLOBAL_RULE_REGEX.test(texts)) {
    return 'global';
  }

  // 3. Check tags for explicit repo or project annotations
  if (Array.isArray(lesson.tags)) {
    for (const tag of lesson.tags) {
      const lower = String(tag).toLowerCase();
      if (lower.startsWith('project:') || lower.startsWith('repo:')) {
        const parts = lower.split(':');
        if (parts[1]) return parts[1];
      }
    }
  }

  return null;
}

/**
 * Determine if a lesson is relevant for the target project.
 * Unscoped/unknown lessons are excluded unless explicitly global.
 */
function isLessonRelevantForProject(lesson, targetProject) {
  if (!lesson) return false;

  // Transcript-shaped lessons are ALWAYS rejected
  if (isTranscriptShaped(lesson)) {
    return false;
  }

  if (!targetProject || targetProject === 'all') {
    return true;
  }

  const normalizedTarget = normalizeProjectName(targetProject);
  const inferred = inferProjectFromLesson(lesson);

  // Global lessons are always permitted across all projects
  if (inferred === 'global') {
    return true;
  }

  // If project is identified, compare
  if (inferred) {
    return normalizeProjectName(inferred) === normalizedTarget;
  }

  // Unscoped/unknown lessons are excluded from project-specific injection
  return false;
}

/**
 * Backfill scope and metadata on memory records.
 * Unknown lessons are left unscoped (null) instead of guessing.
 */
function backfillLessonScopes(memories = []) {
  return memories.map((mem) => {
    if (!mem || typeof mem !== 'object') return mem;
    const inferred = inferProjectFromLesson(mem);
    const existingScope = mem.scope || {};
    const updatedScope = {
      ...(existingScope.entityId ? { entityId: existingScope.entityId } : {}),
      projectId: existingScope.projectId || inferred || null,
      processId: existingScope.processId || 'agent',
      ...(existingScope.sessionId ? { sessionId: existingScope.sessionId } : {}),
    };

    const existingMeta = mem.metadata || {};
    const resolvedProject = existingMeta.project || updatedScope.projectId || null;
    const updatedMetadata = {
      ...existingMeta,
      ...(resolvedProject ? { project: resolvedProject, repo: resolvedProject } : {}),
    };

    return {
      ...mem,
      scope: updatedScope,
      metadata: updatedMetadata,
    };
  });
}

module.exports = {
  TRANSCRIPT_XML_TAGS,
  GLOBAL_RULE_REGEX,
  normalizeProjectName,
  isTranscriptShaped,
  resolveProjectFromCwd,
  inferProjectFromLesson,
  isLessonRelevantForProject,
  backfillLessonScopes,
  clearCwdCache,
  getDiskCachePath,
};
