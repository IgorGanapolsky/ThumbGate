#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { resolveFeedbackDir } = require('./feedback-paths');

const NEG = new Set(['negative', 'negative_strong', 'down', 'thumbs_down']);
const POS = new Set(['positive', 'positive_strong', 'up', 'thumbs_up']);

/** Minimum cluster size to generate a skill */
const MIN_CLUSTER_SIZE = 3;

/** Minimum tag overlap to consider two entries related */
const MIN_TAG_OVERLAP = 2;

// ---------------------------------------------------------------------------
// Directory discovery (mirrors feedback-loop.js)
// ---------------------------------------------------------------------------

/**
 * Discover the feedback directory using the standard ThumbGate resolution order:
 *   1. THUMBGATE_FEEDBACK_DIR env var
 *   2. .thumbgate/ in cwd
 *   3. .claude/memory/feedback/ in cwd
 *   4. ~/.thumbgate/projects/<cwd-basename>/
 * @returns {string} Resolved feedback directory path
 */
function discoverFeedbackDir() {
  return resolveFeedbackDir();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Ensure a directory exists, creating it recursively if needed.
 * @param {string} dirPath
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Append a JSON record as a single line to a JSONL file.
 * @param {string} filePath
 * @param {object} record
 */
function appendJSONL(filePath, record) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
}

/**
 * Parse a JSONL feedback file into an array of entries.
 * @param {string} filePath
 * @returns {object[]}
 */
function parseFeedbackFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const entries = [];
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { entries.push(JSON.parse(trimmed)); } catch { /* skip malformed */ }
  }
  return entries;
}

/**
 * Classify a feedback entry signal as positive, negative, or null.
 * @param {object} entry
 * @returns {'positive'|'negative'|null}
 */
function classifySignal(entry) {
  const sig = (entry.signal || entry.feedback || '').toLowerCase();
  if (NEG.has(sig)) return 'negative';
  if (POS.has(sig)) return 'positive';
  return null;
}

/**
 * Extract tags from a feedback entry, including richContext.domain.
 * @param {object} entry
 * @returns {string[]}
 */
function extractTags(entry) {
  const tags = new Set();
  if (Array.isArray(entry.tags)) {
    for (const t of entry.tags) {
      if (t && typeof t === 'string') tags.add(t.toLowerCase());
    }
  }
  if (entry.richContext && entry.richContext.domain) {
    tags.add(entry.richContext.domain.toLowerCase());
  }
  if (entry.task_category) {
    tags.add(entry.task_category.toLowerCase());
  }
  if (entry.category) {
    tags.add(entry.category.toLowerCase());
  }
  return [...tags];
}

/**
 * Count overlapping elements between two string arrays.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {number}
 */
function tagOverlap(a, b) {
  const setB = new Set(b);
  let count = 0;
  for (const t of a) {
    if (setB.has(t)) count++;
  }
  return count;
}

/**
 * Slugify a string for use as a filename.
 * @param {string} str
 * @returns {string}
 */
function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

// ---------------------------------------------------------------------------
// Clustering
// ---------------------------------------------------------------------------

/**
 * Cluster negative feedback entries by tag overlap (>= minOverlap shared tags).
 * Uses a single-pass union approach: each entry joins the first cluster
 * it overlaps with, or starts a new one.
 *
 * @param {object[]} negEntries - Negative feedback entries (already classified)
 * @param {number} [minOverlap=2] - Minimum shared tags to merge into a cluster
 * @returns {Map<string, {tags: string[], entries: object[]}>}
 */
function clusterByTags(negEntries, minOverlap) {
  if (minOverlap === undefined) minOverlap = MIN_TAG_OVERLAP;

  /** @type {Array<{tags: Set<string>, entries: object[]}>} */
  const clusters = [];

  for (const entry of negEntries) {
    const entryTags = extractTags(entry);
    if (entryTags.length === 0) continue;

    let merged = false;
    for (const cluster of clusters) {
      const clusterTagsArr = [...cluster.tags];
      if (tagOverlap(entryTags, clusterTagsArr) >= minOverlap) {
        cluster.entries.push(entry);
        for (const t of entryTags) cluster.tags.add(t);
        merged = true;
        break;
      }
    }

    if (!merged) {
      clusters.push({ tags: new Set(entryTags), entries: [entry] });
    }
  }

  // Convert to a map keyed by sorted tag string
  const result = new Map();
  for (const cluster of clusters) {
    const key = [...cluster.tags].sort().join(', ');
    result.set(key, {
      tags: [...cluster.tags].sort(),
      entries: cluster.entries,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Skill generation
// ---------------------------------------------------------------------------

/**
 * Build DO rules from positive feedback entries whose tags overlap with the cluster.
 * @param {object[]} posEntries - All positive feedback entries
 * @param {string[]} clusterTags - Tags from the negative cluster
 * @returns {string[]}
 */
function buildDoRules(posEntries, clusterTags) {
  const rules = [];
  const seen = new Set();

  for (const entry of posEntries) {
    const entryTags = extractTags(entry);
    if (tagOverlap(entryTags, clusterTags) < 1) continue;

    const text = entry.whatWorked || entry.context || '';
    if (!text || text.length < 10) continue;

    const normalized = text.slice(0, 120).toLowerCase().trim();
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    rules.push(text.slice(0, 200));
  }
  return rules;
}

/**
 * Build INSTEAD rules from the negative entries in a cluster.
 * @param {object[]} negEntries - Negative entries from the cluster
 * @returns {string[]}
 */
function buildInsteadRules(negEntries) {
  const rules = [];
  const seen = new Set();

  for (const entry of negEntries) {
    const text = entry.whatWentWrong || entry.whatToChange || entry.context || '';
    if (!text || text.length < 10) continue;

    const normalized = text.slice(0, 120).toLowerCase().trim();
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    rules.push(text.slice(0, 200));
  }
  return rules;
}

/**
 * Generate a SKILL.md string from a single cluster.
 *
 * @param {{tags: string[], entries: object[], doRules: string[], insteadRules: string[], approvalRate: string}} cluster
 * @returns {string}
 */
function generateSkillFromCluster(cluster) {
  const { tags, entries, approvalRate } = cluster;
  const doRules = cluster.doRules || (cluster.positiveEntries ? buildDoRules(cluster.positiveEntries, tags) : []);
  const insteadRules = cluster.insteadRules || buildInsteadRules(entries);
  const name = tags.slice(0, 3).join('-') || 'unnamed';
  const description = `Prevention rules for ${tags.join(', ')} domain — auto-generated from ${entries.length} negative feedback signals.`;
  const triggers = tags.map(t => `- Task involves \`${t}\``).join('\n');

  const lines = [];

  // Frontmatter
  lines.push('---');
  lines.push(`name: ${name}`);
  lines.push(`description: ${description}`);
  lines.push(`generated: ${new Date().toISOString()}`);
  lines.push(`evidence_count: ${entries.length}`);
  lines.push(`approval_rate: ${approvalRate}`);
  lines.push('---');
  lines.push('');

  // Trigger conditions
  lines.push('# Trigger Conditions');
  lines.push('');
  lines.push(triggers);
  lines.push('');

  // DO rules
  lines.push('# DO Rules');
  lines.push('');
  if (doRules.length > 0) {
    for (const rule of doRules) {
      lines.push(`- ${rule}`);
    }
  } else {
    lines.push('- No positive patterns recorded yet for this domain.');
  }
  lines.push('');

  // INSTEAD rules
  lines.push('# INSTEAD Rules');
  lines.push('');
  if (insteadRules.length > 0) {
    for (const rule of insteadRules) {
      lines.push(`- NEVER: ${rule}`);
    }
  } else {
    lines.push('- No recurring anti-patterns extracted.');
  }
  lines.push('');

  // Evidence
  lines.push('# Evidence');
  lines.push('');
  lines.push(`- **Negative signals**: ${entries.length}`);
  lines.push(`- **Domain approval rate**: ${approvalRate}`);
  lines.push(`- **Tags**: ${tags.join(', ')}`);
  lines.push(`- **DO rules**: ${doRules.length}`);
  lines.push(`- **INSTEAD rules**: ${insteadRules.length}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate skill files from ThumbGate feedback logs.
 *
 * Reads the feedback log, clusters negative feedback by tag overlap,
 * and produces SKILL.md files for clusters with 3+ entries.
 *
 * @param {object} [options]
 * @param {string} [options.feedbackDir] - Override feedback directory
 * @param {number} [options.minClusterSize] - Minimum entries per cluster (default 3)
 * @param {number} [options.minTagOverlap] - Minimum tag overlap for clustering (default 2)
 * @param {boolean} [options.dryRun] - If true, return results without writing files
 * @returns {{skillName: string, filePath: string, ruleCount: number, evidenceCount: number}[]}
 */
function generateSkills(options) {
  if (!options) options = {};
  const feedbackDir = options.feedbackDir || discoverFeedbackDir();
  const minClusterSize = options.minClusterSize || MIN_CLUSTER_SIZE;
  const minTagOverlap = options.minTagOverlap || MIN_TAG_OVERLAP;
  const dryRun = options.dryRun || false;

  const logPath = path.join(feedbackDir, 'feedback-log.jsonl');
  const outputDir = path.join(feedbackDir, 'generated-skills');
  const auditLogPath = path.join(feedbackDir, 'skill-generation-audit.jsonl');

  const entries = parseFeedbackFile(logPath);
  if (entries.length === 0) return [];

  // Separate positive and negative entries
  const posEntries = [];
  const negEntries = [];
  for (const entry of entries) {
    const cls = classifySignal(entry);
    if (cls === 'positive') posEntries.push(entry);
    else if (cls === 'negative') negEntries.push(entry);
  }

  if (negEntries.length === 0) return [];

  // Cluster negative feedback by tag overlap
  const clusters = clusterByTags(negEntries, minTagOverlap);

  const results = [];

  for (const [key, cluster] of clusters) {
    if (cluster.entries.length < minClusterSize) continue;

    // Compute domain-scoped approval rate
    const clusterTags = cluster.tags;
    let domainPos = 0;
    const domainNeg = cluster.entries.length;
    for (const pe of posEntries) {
      if (tagOverlap(extractTags(pe), clusterTags) >= 1) domainPos++;
    }
    const domainTotal = domainPos + domainNeg;
    const approvalRate = domainTotal > 0
      ? `${((domainPos / domainTotal) * 100).toFixed(1)}%`
      : '0.0%';

    const doRules = buildDoRules(posEntries, clusterTags);
    const insteadRules = buildInsteadRules(cluster.entries);
    const ruleCount = doRules.length + insteadRules.length;

    const skillContent = generateSkillFromCluster({
      tags: clusterTags,
      entries: cluster.entries,
      doRules,
      insteadRules,
      approvalRate,
    });

    const skillName = slugify(clusterTags.slice(0, 3).join('-')) || 'unnamed';
    const fileName = `${skillName}.SKILL.md`;
    const filePath = path.join(outputDir, fileName);

    if (!dryRun) {
      ensureDir(outputDir);
      fs.writeFileSync(filePath, skillContent, 'utf8');

      // Audit log
      appendJSONL(auditLogPath, {
        event: 'skill_generated',
        skillName,
        filePath,
        ruleCount,
        evidenceCount: cluster.entries.length,
        tags: clusterTags,
        approvalRate,
        timestamp: new Date().toISOString(),
      });
    }

    results.push({
      skillName,
      filePath,
      ruleCount,
      evidenceCount: cluster.entries.length,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  try {
    const dryRun = process.argv.includes('--dry-run');
    const feedbackDir = process.argv.find(function(a) {
      return !a.startsWith('-') && a !== process.argv[0] && a !== process.argv[1];
    });
    const results = generateSkills({ feedbackDir: feedbackDir || undefined, dryRun: dryRun });

    if (results.length === 0) {
      console.log('No clusters met the threshold for skill generation.');
    } else {
      console.log('Generated ' + results.length + ' skill(s):');
      for (const r of results) {
        console.log('  ' + r.skillName + ' — ' + r.ruleCount + ' rules, ' + r.evidenceCount + ' signals → ' + r.filePath);
      }
    }
    if (dryRun) console.log('(dry run — no files written)');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

module.exports = {
  generateSkills,
  generateSkillFromCluster,
  discoverFeedbackDir,
  clusterByTags,
  extractTags,
  parseFeedbackFile,
  classifySignal,
};
