'use strict';

/**
 * project-scope.js — Fixed-schema project scoping and transcript filtering
 * for ThumbGate lesson retrieval and feedback capture.
 *
 * Pattern: Dual-Model MoA & Agentic GraphRAG Playbook (Schema-Constrained Extraction).
 *
 * Solves:
 * 1. Scope pollution: Cross-project lesson leakage (e.g. StockService, Dayglass
 *    lessons appearing in a ThumbGate repository session).
 * 2. Transport transcript pollution: Junk lessons containing raw runner XML
 *    (<task-notification>, <tool-use-id>, <output-file>, <task-id>) cluttering
 *    PreToolUse additionalContext.
 * 3. Empty-over-noise: If nothing scoped scores above threshold, return empty.
 */

const fs = require('node:fs');
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

const KNOWN_PROJECT_PATTERNS = Object.freeze([
  {
    name: 'StockService',
    regex: /\b(?:stockservice|dist03-|opdx|swagger\s+dealer|single\s+sku|ado\s+rest|workitemrefs|ab#\d+)\b/i,
  },
  {
    name: 'Dayglass',
    regex: /\b(?:dayglass|screenpipe|foresight|dayglass-server|com\.iganapolsky\.dayglass)\b/i,
  },
  {
    name: 'ECI-AI-Studio',
    regex: /\b(?:jev\s+router|eci\s+ai\s+studio)\b/i,
  },
  {
    name: 'Apple-Developer',
    regex: /\b(?:apple\s+developer|setapp|provisioning\s+profile)\b/i,
  },
  {
    name: 'Wisdom',
    regex: /\b(?:wisdom\s+policy(?:-pack)?|wisdom\s+rules?)\b/i,
  },
  {
    name: 'ThumbGate',
    regex: /\b(?:thumbgate|thumbgate\.ai|gate-check|pretooluse|thumbgate-production)\b/i,
  },
  {
    name: 'mac-yolo-safeguards',
    regex: /\b(?:mac-yolo-safeguards|mac_yolo_safeguards)\b/i,
  },
  {
    name: 'RealEstate',
    regex: /\b(?:realestate|real_estate|tax-deed|fl-tax-deeds)\b/i,
  },
]);

const GLOBAL_RULE_REGEX = /\b(?:never\s+kill\s+processes|bypass\s+branch\s+protection|git\s+worktree|fail-closed|branch\s+protection)\b/i;

function normalizeProjectName(name) {
  if (!name || typeof name !== 'string') return '';
  let cleaned = name.trim().toLowerCase();
  // Strip worktree and branch suffixes like -wt-..., .worktrees, etc.
  cleaned = cleaned.replace(/[-_]wt[-_].*$/, '');
  cleaned = cleaned.replace(/\.worktrees.*$/, '');
  cleaned = cleaned.replace(/[-_]poolside[-_].*$/, '');
  cleaned = cleaned.replace(/[-_]branch[-_].*$/, '');
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

/**
 * Resolve the project name from a working directory or git root.
 */
function resolveProjectFromCwd(dir) {
  const targetDir = dir ? path.resolve(dir) : process.cwd();

  // 1. Try git remote
  try {
    const gitOutput = execFileSync('git', ['-C', targetDir, 'config', '--get', 'remote.origin.url'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500,
    }).trim();
    if (gitOutput) {
      // Parse git@github.com:owner/Repo.git or https://github.com/owner/Repo.git
      const match = gitOutput.match(/[/:](\w[-\w]+)\/(\w[-\w]+?)(?:\.git)?$/);
      if (match && match[2]) {
        return match[2];
      }
      const slashBase = path.basename(gitOutput.replace(/\.git$/, ''));
      if (slashBase) return slashBase;
    }
  } catch {
    // Git probe failed, fall through
  }

  // 2. Try git top-level directory name
  try {
    const topLevel = execFileSync('git', ['-C', targetDir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500,
    }).trim();
    if (topLevel) {
      return path.basename(topLevel);
    }
  } catch {
    // Fall through
  }

  // 3. Try nearest package.json
  try {
    let curr = targetDir;
    while (curr && curr !== path.dirname(curr)) {
      const pkgPath = path.join(curr, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.name) {
          const pkgName = pkg.name.startsWith('@') ? pkg.name.split('/')[1] : pkg.name;
          return pkgName;
        }
      }
      curr = path.dirname(curr);
    }
  } catch {
    // Fall through
  }

  return path.basename(targetDir);
}

/**
 * Infer the project associated with a lesson from its declared scope or text.
 */
function inferProjectFromLesson(lesson) {
  if (!lesson || typeof lesson !== 'object') return null;

  // 1. Explicit scope or metadata
  const declaredProject = lesson.scope?.projectId || lesson.metadata?.project || lesson.metadata?.repoId;
  if (declaredProject && typeof declaredProject === 'string' && declaredProject !== 'default' && declaredProject !== 'agent') {
    return declaredProject;
  }

  // 2. Check for global rules
  if (
    lesson.shared === true ||
    lesson.scope?.shared === true ||
    lesson.scope === 'global' ||
    lesson.metadata?.scope === 'global' ||
    (Array.isArray(lesson.tags) && lesson.tags.includes('global'))
  ) {
    return 'global';
  }

  // 3. Inspect text content
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

  for (const { name, regex } of KNOWN_PROJECT_PATTERNS) {
    if (regex.test(texts)) {
      return name;
    }
  }

  return null;
}

/**
 * Determine if a lesson is relevant for the target project.
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

  if (inferred) {
    return normalizeProjectName(inferred) === normalizedTarget;
  }

  // If no specific project was inferred, check if tags explicitly associate with another project
  if (Array.isArray(lesson.tags)) {
    for (const tag of lesson.tags) {
      const lower = String(tag).toLowerCase();
      if (lower.startsWith('project:') || lower.startsWith('repo:')) {
        const tagProj = lower.split(':')[1];
        if (tagProj && normalizeProjectName(tagProj) !== normalizedTarget) {
          return false;
        }
      }
    }
  }

  // Truly generic lesson with no project conflicts is allowed
  return true;
}

/**
 * Backfill scope and metadata on memory records.
 */
function backfillLessonScopes(memories = []) {
  return memories.map((mem) => {
    if (!mem || typeof mem !== 'object') return mem;
    const inferred = inferProjectFromLesson(mem);
    const existingScope = mem.scope || {};
    const updatedScope = {
      entityId: existingScope.entityId || 'iganapolsky',
      projectId: existingScope.projectId || inferred || 'ThumbGate',
      processId: existingScope.processId || 'agent',
      sessionId: existingScope.sessionId || `session_${Date.now()}`,
    };

    return {
      ...mem,
      scope: updatedScope,
      metadata: {
        ...(mem.metadata || {}),
        project: mem.metadata?.project || inferred || updatedScope.projectId,
      },
    };
  });
}

module.exports = {
  TRANSCRIPT_XML_TAGS,
  normalizeProjectName,
  isTranscriptShaped,
  resolveProjectFromCwd,
  inferProjectFromLesson,
  isLessonRelevantForProject,
  backfillLessonScopes,
};
