'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJSONL(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function slugify(text, maxLen) {
  maxLen = maxLen || 80;
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen);
}

function extractDate(entry) {
  const ts = entry.timestamp || entry.date || entry.createdAt || entry.promotedAt || '';
  if (!ts) return 'unknown';
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return 'unknown';
  return d.toISOString().slice(0, 10);
}

/**
 * Escape a YAML value — wrap in quotes if it contains colons, special chars,
 * or starts with a YAML-special character.
 */
function yamlEscape(value) {
  if (value === null || value === undefined) return '""';
  const s = String(value);
  if (s === '') return '""';
  // Wrap in double quotes if it contains colons, #, [], {}, `, or starts with special chars
  if (/[:\#\[\]\{\}`|>]/.test(s) || /^[&*!%@]/.test(s) || /^['"]/.test(s) || s.includes('\n')) {
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return s;
}

function yamlArray(arr) {
  if (!arr || arr.length === 0) return '[]';
  return '\n' + arr.map((item) => '  - ' + yamlEscape(item)).join('\n');
}

function buildFrontmatter(fields) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      lines.push(key + ': ' + yamlArray(value));
    } else {
      lines.push(key + ': ' + yamlEscape(value));
    }
  }
  lines.push('---');
  return lines.join('\n');
}

function wikiLink(name) {
  return '[[' + String(name || '') + ']]';
}

function tagWikiLinks(tags) {
  if (!tags || !Array.isArray(tags) || tags.length === 0) return '';
  return tags.map((t) => wikiLink(t)).join(', ');
}

function writeNote(filePath, frontmatter, body) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, frontmatter + '\n\n' + body.trim() + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Export: Feedback Log
// ---------------------------------------------------------------------------

function exportFeedbackLog(feedbackDir, outputDir) {
  const errors = [];
  let exported = 0;
  const logPath = path.join(feedbackDir, 'feedback-log.jsonl');
  const entries = readJSONL(logPath);
  const outDir = path.join(outputDir, 'Feedback');
  ensureDir(outDir);

  for (const entry of entries) {
    try {
      if (!entry || !entry.id) {
        errors.push('Skipped feedback entry with missing id');
        continue;
      }
      const date = extractDate(entry);
      const slug = slugify(entry.context || entry.whatWentWrong || entry.whatWorked || entry.id);
      const fileName = date + '-' + slug + '.md';

      const signal = entry.signal === 'positive' || entry.signal === 'up' ? 'up' : 'down';
      const tags = Array.isArray(entry.tags) ? entry.tags : [];
      const category = entry.category || (tags[0] || 'uncategorized');
      const actionType = entry.actionType || entry.action || 'feedback';

      const fm = buildFrontmatter({
        title: entry.context || entry.whatWentWrong || entry.whatWorked || entry.id,
        date: date,
        signal: signal,
        category: category,
        tags: tags,
        actionType: actionType,
        sourceFeedbackId: entry.id,
      });

      const bodyParts = ['# ' + (entry.context || entry.id)];
      if (entry.whatWentWrong) {
        bodyParts.push('\n## Context\n\n' + entry.whatWentWrong);
      }
      if (entry.whatWorked) {
        bodyParts.push('\n## What Worked\n\n' + entry.whatWorked);
      }
      if (entry.correctiveAction || entry.whatToChange) {
        bodyParts.push('\n## Corrective Action\n\n' + (entry.correctiveAction || entry.whatToChange));
      }
      if (tags.length > 0) {
        bodyParts.push('\n## Tags\n\n' + tagWikiLinks(tags));
      }
      if (entry.toolName) {
        bodyParts.push('\n## Tool\n\n`' + entry.toolName + '`');
      }

      writeNote(path.join(outDir, fileName), fm, bodyParts.join('\n'));
      exported++;
    } catch (err) {
      errors.push('Feedback entry error: ' + (err.message || String(err)));
    }
  }

  return { exported, errors };
}

// ---------------------------------------------------------------------------
// Export: Memory Log
// ---------------------------------------------------------------------------

function exportMemoryLog(feedbackDir, outputDir) {
  const errors = [];
  let exported = 0;
  const logPath = path.join(feedbackDir, 'memory-log.jsonl');
  const entries = readJSONL(logPath);
  const outDir = path.join(outputDir, 'Memories');
  ensureDir(outDir);

  for (const entry of entries) {
    try {
      if (!entry || !entry.id) {
        errors.push('Skipped memory entry with missing id');
        continue;
      }
      const date = extractDate(entry);
      const slug = slugify(entry.title || entry.content || entry.id);
      const fileName = date + '-' + slug + '.md';

      const tags = Array.isArray(entry.tags) ? entry.tags : [];
      const category = entry.category || 'uncategorized';
      const signal = entry.signal || (category === 'error' ? 'down' : 'up');

      const fm = buildFrontmatter({
        title: entry.title || entry.id,
        date: date,
        category: category,
        tags: tags,
        signal: signal,
      });

      const bodyParts = ['# ' + (entry.title || entry.id)];
      if (entry.content) {
        bodyParts.push('\n' + entry.content);
      }
      if (tags.length > 0) {
        bodyParts.push('\n## Tags\n\n' + tagWikiLinks(tags));
      }
      if (entry.sourceFeedbackId) {
        bodyParts.push('\n## Source\n\nBacklink: ' + wikiLink('Feedback/' + entry.sourceFeedbackId));
      }

      writeNote(path.join(outDir, fileName), fm, bodyParts.join('\n'));
      exported++;
    } catch (err) {
      errors.push('Memory entry error: ' + (err.message || String(err)));
    }
  }

  return { exported, errors };
}

// ---------------------------------------------------------------------------
// Export: Prevention Rules
// ---------------------------------------------------------------------------

function deriveSeverity(text) {
  const s = String(text || '').toLowerCase();
  if (/\bcritical\b|\bblock\b|\bblocked\b|\bnever\b|\bforce push\b/.test(s)) return 'critical';
  if (/\bhigh\b|\bwarn\b|\bdanger\b/.test(s)) return 'high';
  if (/\blow\b|\bminor\b/.test(s)) return 'low';
  return 'medium';
}

function parsePreventionRulesMarkdown(content) {
  const rules = [];
  if (!content) return rules;

  const lines = content.split('\n');
  let current = null;

  for (const line of lines) {
    // Match rule headers like "## Rule: ...", "### ...", "## 1. ..." (skip top-level # headers)
    const headerMatch = line.match(/^#{2,3}\s+(?:Rule:\s*)?(?:\d+\.\s*)?(.+)/);
    if (headerMatch) {
      if (current && current.title) {
        // Derive severity from title + body before pushing
        current.severity = deriveSeverity(current.title + ' ' + current.body);
        rules.push(current);
      }
      current = {
        title: headerMatch[1].trim(),
        severity: 'medium',
        source: 'prevention-rules.md',
        body: '',
      };
      continue;
    }
    if (current) {
      current.body += line + '\n';
    }
  }
  if (current && current.title) {
    current.severity = deriveSeverity(current.title + ' ' + current.body);
    rules.push(current);
  }

  return rules;
}

function exportPreventionRules(feedbackDir, outputDir) {
  const errors = [];
  let exported = 0;
  const rulesPath = path.join(feedbackDir, 'prevention-rules.md');
  const outDir = path.join(outputDir, 'Rules');
  ensureDir(outDir);

  if (!fs.existsSync(rulesPath)) {
    return { exported: 0, errors: [] };
  }

  let content;
  try {
    content = fs.readFileSync(rulesPath, 'utf-8');
  } catch (err) {
    return { exported: 0, errors: ['Failed to read prevention-rules.md: ' + err.message] };
  }

  const rules = parsePreventionRulesMarkdown(content);
  const indexLinks = [];

  for (const rule of rules) {
    try {
      const slug = slugify(rule.title);
      if (!slug) {
        errors.push('Skipped rule with empty title');
        continue;
      }
      const fileName = slug + '.md';

      const fm = buildFrontmatter({
        title: rule.title,
        type: 'prevention-rule',
        severity: rule.severity,
        source: rule.source,
      });

      const body = '# ' + rule.title + '\n\n' + (rule.body || '').trim();
      writeNote(path.join(outDir, fileName), fm, body);
      indexLinks.push('- ' + wikiLink('Rules/' + slug));
      exported++;
    } catch (err) {
      errors.push('Rule export error: ' + (err.message || String(err)));
    }
  }

  // Write index
  if (indexLinks.length > 0) {
    const indexFm = buildFrontmatter({
      title: 'Prevention Rules Index',
      type: 'index',
    });
    const indexBody = '# Prevention Rules Index\n\n' + indexLinks.join('\n');
    writeNote(path.join(outDir, 'Prevention Rules Index.md'), indexFm, indexBody);
  }

  return { exported, errors };
}

// ---------------------------------------------------------------------------
// Export: Gates
// ---------------------------------------------------------------------------

function exportGates(configPath, outputDir) {
  const errors = [];
  let exported = 0;
  const outDir = path.join(outputDir, 'Gates');
  ensureDir(outDir);

  let gates = [];

  // Read default gates config
  if (fs.existsSync(configPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (Array.isArray(raw.gates)) {
        gates = gates.concat(raw.gates);
      }
    } catch (err) {
      errors.push('Failed to read gates config: ' + err.message);
    }
  }

  // Read auto-promoted gates if present (check common locations)
  const autoGatePaths = [
    path.join(path.dirname(configPath), '..', '.rlhf', 'auto-promoted-gates.json'),
    path.join(path.dirname(configPath), '..', '.claude', 'memory', 'feedback', 'auto-promoted-gates.json'),
  ];
  for (const agPath of autoGatePaths) {
    if (fs.existsSync(agPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(agPath, 'utf-8'));
        if (Array.isArray(raw.gates)) {
          gates = gates.concat(raw.gates);
        }
      } catch (err) {
        errors.push('Failed to read auto-promoted gates: ' + err.message);
      }
    }
  }

  const indexLinks = [];

  for (const gate of gates) {
    try {
      if (!gate || !gate.id) {
        errors.push('Skipped gate with missing id');
        continue;
      }
      const fileName = gate.id + '.md';
      const action = gate.action || 'warn';
      const tool = gate.trigger || gate.tool || 'any';
      const pattern = gate.pattern || '';

      const fm = buildFrontmatter({
        title: gate.id,
        type: 'gate',
        action: action,
        tool: tool,
        pattern: pattern,
        severity: gate.severity || 'medium',
        layer: gate.layer || 'unknown',
      });

      const bodyParts = ['# Gate: ' + gate.id];
      if (gate.message) {
        bodyParts.push('\n## Description\n\n' + gate.message);
      }
      bodyParts.push('\n## Match Conditions\n');
      bodyParts.push('- **Pattern**: `' + pattern + '`');
      bodyParts.push('- **Layer**: ' + (gate.layer || 'unknown'));
      if (gate.unless) {
        bodyParts.push('- **Unless**: `' + gate.unless + '`');
      }
      bodyParts.push('\n## Enforcement\n');
      bodyParts.push('- **Action**: ' + action);
      bodyParts.push('- **Severity**: ' + (gate.severity || 'medium'));

      writeNote(path.join(outDir, fileName), fm, bodyParts.join('\n'));
      indexLinks.push('- ' + wikiLink('Gates/' + gate.id));
      exported++;
    } catch (err) {
      errors.push('Gate export error: ' + (err.message || String(err)));
    }
  }

  // Write index
  if (indexLinks.length > 0) {
    const indexFm = buildFrontmatter({
      title: 'Gates Index',
      type: 'index',
    });
    const indexBody = '# Gates Index\n\n' + indexLinks.join('\n');
    writeNote(path.join(outDir, 'Gates Index.md'), indexFm, indexBody);
  }

  return { exported, errors };
}

// ---------------------------------------------------------------------------
// Export: ContextFS Packs
// ---------------------------------------------------------------------------

function exportContextFsPacks(feedbackDir, outputDir) {
  const errors = [];
  let exported = 0;
  const provDir = path.join(feedbackDir, 'contextfs', 'provenance');
  const outDir = path.join(outputDir, 'Context Packs');
  ensureDir(outDir);

  if (!fs.existsSync(provDir)) {
    return { exported: 0, errors: [] };
  }

  // Read packs.jsonl
  const packsPath = path.join(provDir, 'packs.jsonl');
  const packs = readJSONL(packsPath);

  // Also try reading individual JSON files in provenance
  let provFiles = [];
  try {
    provFiles = fs.readdirSync(provDir).filter((f) => f.endsWith('.json'));
  } catch (_) { /* ignore */ }

  for (const file of provFiles) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(provDir, file), 'utf-8'));
      if (raw && raw.packId && !packs.find((p) => p.packId === raw.packId)) {
        packs.push(raw);
      }
    } catch (_) { /* skip malformed */ }
  }

  for (const pack of packs) {
    try {
      if (!pack || !pack.packId) {
        errors.push('Skipped pack with missing packId');
        continue;
      }
      const date = extractDate(pack);
      const fileName = pack.packId + '.md';

      const fm = buildFrontmatter({
        packId: pack.packId,
        date: date,
        template: pack.template || 'unknown',
        itemCount: pack.itemCount || (Array.isArray(pack.items) ? pack.items.length : 0),
        usedChars: pack.usedChars || pack.charCount || 0,
      });

      const bodyParts = ['# Context Pack: ' + pack.packId];
      if (pack.template) {
        bodyParts.push('\n**Template**: ' + pack.template);
      }
      if (Array.isArray(pack.items) && pack.items.length > 0) {
        bodyParts.push('\n## Items\n');
        for (const item of pack.items) {
          if (typeof item === 'string') {
            bodyParts.push('- ' + item);
          } else if (item && item.id) {
            bodyParts.push('- ' + wikiLink(item.namespace ? item.namespace + '/' + item.id : item.id));
          } else if (item && item.content) {
            bodyParts.push('- ' + String(item.content).slice(0, 100));
          }
        }
      }
      if (pack.outcome) {
        bodyParts.push('\n## Outcome\n\n' + String(pack.outcome));
      }

      writeNote(path.join(outDir, fileName), fm, bodyParts.join('\n'));
      exported++;
    } catch (err) {
      errors.push('ContextFS pack error: ' + (err.message || String(err)));
    }
  }

  return { exported, errors };
}

// ---------------------------------------------------------------------------
// Export: Promoted Lessons
// ---------------------------------------------------------------------------

function exportLessons(feedbackDir, outputDir) {
  const errors = [];
  let exported = 0;
  const outDir = path.join(outputDir, 'Lessons');
  ensureDir(outDir);

  // Lessons come from feedback entries that were promoted (generated rules or have promoted flag)
  const feedbackPath = path.join(feedbackDir, 'feedback-log.jsonl');
  const memoryPath = path.join(feedbackDir, 'memory-log.jsonl');

  const feedbackEntries = readJSONL(feedbackPath);
  const memoryEntries = readJSONL(memoryPath);

  // Promoted lessons: memories with category 'learning' or 'error' that have content,
  // or feedback entries with promoted flag
  const lessons = [];

  for (const mem of memoryEntries) {
    if (!mem || !mem.id) continue;
    const isPromoted = mem.promoted === true ||
      mem.category === 'learning' ||
      (mem.category === 'error' && mem.content);
    if (isPromoted) {
      lessons.push(mem);
    }
  }

  // Also check feedback for explicitly promoted entries
  for (const fb of feedbackEntries) {
    if (!fb || !fb.id) continue;
    if (fb.promoted === true && !lessons.find((l) => l.sourceFeedbackId === fb.id || l.id === fb.id)) {
      lessons.push({
        id: fb.id,
        title: fb.context || fb.whatWentWrong || fb.whatWorked || fb.id,
        date: fb.timestamp,
        timestamp: fb.timestamp,
        category: fb.category || 'learning',
        tags: fb.tags,
        content: fb.correctiveAction || fb.whatToChange || fb.whatWorked || '',
        promoted: true,
        sourceFeedbackId: fb.id,
      });
    }
  }

  const indexLinks = [];

  for (const lesson of lessons) {
    try {
      const date = extractDate(lesson);
      const slug = slugify(lesson.title || lesson.content || lesson.id);
      if (!slug) {
        errors.push('Skipped lesson with empty slug');
        continue;
      }
      const fileName = date + '-' + slug + '.md';

      const tags = Array.isArray(lesson.tags) ? lesson.tags : [];
      const linkedRules = Array.isArray(lesson.linkedRules) ? lesson.linkedRules : [];
      const linkedGates = Array.isArray(lesson.linkedGates) ? lesson.linkedGates : [];

      const fm = buildFrontmatter({
        title: lesson.title || lesson.id,
        date: date,
        category: lesson.category || 'learning',
        promoted: true,
        linkedRules: linkedRules,
        linkedGates: linkedGates,
      });

      const bodyParts = ['# ' + (lesson.title || lesson.id)];
      if (lesson.content) {
        bodyParts.push('\n## Corrective Action\n\n' + lesson.content);
      }
      if (lesson.lifecycleState || lesson.state) {
        bodyParts.push('\n## Lifecycle State\n\n' + (lesson.lifecycleState || lesson.state));
      }
      if (linkedRules.length > 0) {
        bodyParts.push('\n## Linked Rules\n\n' + linkedRules.map((r) => wikiLink('Rules/' + slugify(r))).join(', '));
      }
      if (linkedGates.length > 0) {
        bodyParts.push('\n## Linked Gates\n\n' + linkedGates.map((g) => wikiLink('Gates/' + g)).join(', '));
      }
      if (tags.length > 0) {
        bodyParts.push('\n## Tags\n\n' + tagWikiLinks(tags));
      }
      if (lesson.sourceFeedbackId) {
        bodyParts.push('\n## Source\n\nBacklink: ' + wikiLink('Feedback/' + lesson.sourceFeedbackId));
      }

      writeNote(path.join(outDir, fileName), fm, bodyParts.join('\n'));
      indexLinks.push('- ' + wikiLink('Lessons/' + date + '-' + slug));
      exported++;
    } catch (err) {
      errors.push('Lesson export error: ' + (err.message || String(err)));
    }
  }

  // Write index
  if (indexLinks.length > 0) {
    const indexFm = buildFrontmatter({
      title: 'Lessons Index',
      type: 'index',
    });
    const indexBody = '# Lessons Index\n\n' + indexLinks.join('\n');
    writeNote(path.join(outDir, 'Lessons Index.md'), indexFm, indexBody);
  }

  return { exported, errors };
}

// ---------------------------------------------------------------------------
// Export All
// ---------------------------------------------------------------------------

function exportAll(options) {
  const feedbackDir = options.feedbackDir;
  const outputDir = options.outputDir;
  const gatesConfigPath = options.gatesConfigPath || path.join(__dirname, '..', 'config', 'gates', 'default.json');
  const includeIndex = options.includeIndex !== false;

  ensureDir(outputDir);

  const feedback = exportFeedbackLog(feedbackDir, outputDir);
  const memories = exportMemoryLog(feedbackDir, outputDir);
  const rules = exportPreventionRules(feedbackDir, outputDir);
  const gates = exportGates(gatesConfigPath, outputDir);
  const packs = exportContextFsPacks(feedbackDir, outputDir);
  const lessons = exportLessons(feedbackDir, outputDir);

  const allErrors = [].concat(
    feedback.errors,
    memories.errors,
    rules.errors,
    gates.errors,
    packs.errors,
    lessons.errors
  );

  const stats = {
    feedback: feedback.exported,
    memories: memories.exported,
    rules: rules.exported,
    gates: gates.exported,
    packs: packs.exported,
    lessons: lessons.exported,
    errors: allErrors,
  };

  if (includeIndex) {
    const indexFm = buildFrontmatter({
      title: 'MCP Memory Gateway',
      type: 'master-index',
      exported: new Date().toISOString(),
    });

    const indexBody = [
      '# MCP Memory Gateway',
      '',
      '## Export Summary',
      '',
      '| Type | Count |',
      '|------|-------|',
      '| Feedback | ' + stats.feedback + ' |',
      '| Memories | ' + stats.memories + ' |',
      '| Prevention Rules | ' + stats.rules + ' |',
      '| Gates | ' + stats.gates + ' |',
      '| Context Packs | ' + stats.packs + ' |',
      '| Lessons | ' + stats.lessons + ' |',
      '',
      '## Indexes',
      '',
      '- ' + wikiLink('Rules/Prevention Rules Index'),
      '- ' + wikiLink('Gates/Gates Index'),
      '- ' + wikiLink('Lessons/Lessons Index'),
      '',
      '## Last Export',
      '',
      new Date().toISOString(),
    ].join('\n');

    writeNote(path.join(outputDir, 'MCP Memory Gateway.md'), indexFm, indexBody);
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

module.exports = {
  exportFeedbackLog,
  exportMemoryLog,
  exportPreventionRules,
  exportGates,
  exportContextFsPacks,
  exportLessons,
  exportAll,
  // Internals exposed for testing
  slugify,
  yamlEscape,
  buildFrontmatter,
  wikiLink,
  parsePreventionRulesMarkdown,
};
