#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CANONICAL_PREFIXES = ['priority:', 'area:', 'status:', 'type:', 'effort:', 'handoff:'];

const CANONICAL_TAXONOMIES = {
  priority: ['priority:p0', 'priority:p1', 'priority:p2', 'priority:p3'],
  status: ['status:ready', 'status:in-progress', 'status:blocked', 'status:review'],
  area: [
    'area:gateway',
    'area:control-plane',
    'area:mobile',
    'area:ci',
    'area:security',
    'area:webmcp',
    'area:dashboard',
    'area:rag',
    'area:eval',
    'area:billing',
  ],
  type: [
    'type:bug',
    'type:feature',
    'type:enhancement',
    'type:documentation',
    'type:security',
    'type:chore',
    'type:perf',
  ],
};

const STANDARD_GITHUB_LABELS = new Set([
  'bug',
  'documentation',
  'duplicate',
  'enhancement',
  'good first issue',
  'help wanted',
  'invalid',
  'question',
  'wontfix',
  'stale',
  'automerge',
  'dependencies',
  'security',
  'webmcp',
]);

const AREA_FILE_PATTERNS = [
  { area: 'area:dashboard', regex: /(^|\/)(public\/dashboard\.html|scripts\/dashboard.*|tests\/dashboard.*)/i },
  { area: 'area:webmcp', regex: /(^|\/)(.*webmcp.*)/i },
  { area: 'area:security', regex: /(^|\/)(.*security.*|.*secret.*|.*guard.*|config\/gates\/)/i },
  { area: 'area:control-plane', regex: /(^|\/)(src\/api\/.*|scripts\/server.*)/i },
  { area: 'area:mobile', regex: /(^|\/)(adapters\/mobile.*|.*hermes-mobile.*)/i },
  { area: 'area:ci', regex: /(^|\/)(.github\/workflows\/.*|scripts\/verify.*|scripts\/prove.*)/i },
  { area: 'area:rag', regex: /(^|\/)(scripts\/vector.*|scripts\/memory.*|scripts\/lesson.*)/i },
  { area: 'area:eval', regex: /(^|\/)(bench\/.*|tests\/eval.*|scripts\/eval.*)/i },
  { area: 'area:billing', regex: /(^|\/)(scripts\/stripe.*|scripts\/billing.*|public\/pricing\.html)/i },
];

/**
 * Classifies a single label into its taxonomy status
 */
function classifyLabel(labelInput, options = {}) {
  const name = typeof labelInput === 'string' ? labelInput.trim() : String(labelInput?.name || '').trim();
  const isExplicitArchived = Boolean(labelInput?.isArchived || labelInput?.archived);

  if (!name) {
    return { name: '', category: 'invalid', isArchived: false, reason: 'Empty label name' };
  }

  if (isExplicitArchived) {
    return { name, category: 'archived', isArchived: true, reason: 'Explicitly archived on GitHub' };
  }

  for (const prefix of CANONICAL_PREFIXES) {
    if (name.toLowerCase().startsWith(prefix)) {
      return {
        name,
        category: 'canonical',
        prefix,
        isArchived: false,
        reason: `Matches canonical fleet prefix '${prefix}'`,
      };
    }
  }

  if (STANDARD_GITHUB_LABELS.has(name.toLowerCase())) {
    return {
      name,
      category: 'standard',
      isArchived: false,
      reason: 'Standard GitHub core repository label',
    };
  }

  return {
    name,
    category: 'archived_candidate',
    isArchived: false,
    reason: 'Ad-hoc or unmanaged label (candidate for archiving to prevent prompt bloat and label sprawl)',
  };
}

/**
 * Audits a collection of labels and produces a taxonomy compliance report
 */
function auditLabels(labels = []) {
  const list = Array.isArray(labels) ? labels : [];
  const classified = list.map((l) => classifyLabel(l));

  const canonical = classified.filter((l) => l.category === 'canonical');
  const standard = classified.filter((l) => l.category === 'standard');
  const archived = classified.filter((l) => l.category === 'archived');
  const candidates = classified.filter((l) => l.category === 'archived_candidate');

  const managedCount = canonical.length + standard.length;
  const total = classified.length;
  const conformanceRate = total > 0 ? Number(((managedCount / total) * 100).toFixed(1)) : 100.0;

  const recommendations = [];
  if (candidates.length > 0) {
    recommendations.push({
      action: 'archive_labels',
      count: candidates.length,
      labels: candidates.map((c) => c.name),
      detail: `Archive ${candidates.length} ad-hoc label(s) on GitHub to keep the active label picker uncluttered while preserving audit history.`,
    });
  }

  if (canonical.length === 0 && total > 0) {
    recommendations.push({
      action: 'bootstrap_canonical_taxonomy',
      detail: 'Adopt canonical fleet prefixes (priority:*, area:*, status:*, type:*) for deterministic agent triage.',
    });
  }

  return {
    total,
    canonicalCount: canonical.length,
    standardCount: standard.length,
    archivedCount: archived.length,
    candidateCount: candidates.length,
    conformanceRate,
    canonicalLabels: canonical.map((l) => l.name),
    standardLabels: standard.map((l) => l.name),
    archivedLabels: archived.map((l) => l.name),
    candidateLabels: candidates.map((l) => l.name),
    recommendations,
  };
}

/**
 * Suggests canonical and standard labels based on context (title, files touched, diff, body)
 */
function suggestLabels(context = {}) {
  const title = String(context.title || '').trim();
  const body = String(context.body || '').trim();
  const files = Array.isArray(context.files) ? context.files : [];
  const diff = String(context.diff || '');

  const suggestions = new Set();
  const rationales = [];

  const combinedText = `${title} ${body} ${diff}`.toLowerCase();

  // 1. Type inference
  if (/^fix(\(.*\))?:|fix(es|ed)?\b|bug|error|crash|regression/i.test(title) || /fix(es|ed)?\b|bug/i.test(combinedText)) {
    suggestions.add('type:bug');
    rationales.push('Matched bug/fix patterns in title or content');
  } else if (/^feat(\(.*\))?:|feature|add(ed|ing)?\b|implement/i.test(title)) {
    suggestions.add('type:feature');
    rationales.push('Matched feature/implementation patterns in title');
  } else if (/^docs(\(.*\))?:|documentation|readme|changelog/i.test(title)) {
    suggestions.add('type:documentation');
    rationales.push('Documentation updates identified');
  } else if (/^perf(\(.*\))?:|performance|latency|budget|speedup/i.test(title)) {
    suggestions.add('type:perf');
    rationales.push('Performance optimization detected');
  } else if (/^chore(\(.*\))?:|cleanup|refactor/i.test(title)) {
    suggestions.add('type:chore');
    rationales.push('Chore/maintenance update identified');
  }

  // 2. Area inference from touched files and text
  for (const pattern of AREA_FILE_PATTERNS) {
    const fileMatch = files.some((f) => pattern.regex.test(f));
    const textMatch = pattern.regex.test(combinedText);
    if (fileMatch || textMatch) {
      suggestions.add(pattern.area);
      rationales.push(`Matched path/keyword pattern for ${pattern.area}`);
    }
  }

  // 3. Priority inference
  if (/p0|blocker|critical|security hole|vulnerability|emergency/i.test(combinedText)) {
    suggestions.add('priority:p0');
    rationales.push('High-severity keyword detected (P0)');
  } else if (/p1|high priority|urgent|soon/i.test(combinedText)) {
    suggestions.add('priority:p1');
    rationales.push('Elevated priority keyword detected (P1)');
  } else if (suggestions.size > 0) {
    suggestions.add('priority:p2');
  }

  // 4. Status inference
  if (context.isDraft) {
    suggestions.add('status:in-progress');
  } else if (context.isBlocked) {
    suggestions.add('status:blocked');
  } else if (context.isReviewReady) {
    suggestions.add('status:review');
  } else {
    suggestions.add('status:ready');
  }

  const suggestedList = Array.from(suggestions);
  return {
    suggestedLabels: suggestedList,
    count: suggestedList.length,
    rationales,
    canonicalTaxonomies: CANONICAL_TAXONOMIES,
  };
}

/**
 * Returns a human-readable markdown formatted audit summary
 */
function formatLabelAuditReport(auditResult) {
  const lines = [
    '### 🏷️ GitHub Label Governance & Archiving Audit',
    '',
    `- **Total Labels**: ${auditResult.total}`,
    `- **Canonical Fleet Labels**: ${auditResult.canonicalCount}`,
    `- **Standard Core Labels**: ${auditResult.standardCount}`,
    `- **Archived Labels**: ${auditResult.archivedCount}`,
    `- **Candidate for Archiving**: ${auditResult.candidateCount}`,
    `- **Taxonomy Conformance**: ${auditResult.conformanceRate}%`,
    '',
  ];

  if (auditResult.candidateLabels.length > 0) {
    lines.push('#### 📦 Candidate Labels for GitHub Archiving (Preserves History):');
    for (const label of auditResult.candidateLabels) {
      lines.push(`- \`${label}\``);
    }
    lines.push('');
  }

  if (auditResult.recommendations.length > 0) {
    lines.push('#### ⚡ Recommended Actions:');
    for (const rec of auditResult.recommendations) {
      lines.push(`- ${rec.detail}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

module.exports = {
  CANONICAL_PREFIXES,
  CANONICAL_TAXONOMIES,
  STANDARD_GITHUB_LABELS,
  classifyLabel,
  auditLabels,
  suggestLabels,
  formatLabelAuditReport,
};
