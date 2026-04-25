#!/usr/bin/env node
'use strict';

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function classifyMemoryFile(filePath) {
  const normalized = normalizeText(filePath).toLowerCase();
  if (/preference|style|tone|format/.test(normalized)) return 'preference';
  if (/credential|token|secret|password|key/.test(normalized)) return 'blocked_secret';
  if (/task|completed|todo|draft/.test(normalized)) return 'workflow_state';
  if (/account|customer|user|contact/.test(normalized)) return 'sensitive_context';
  return 'general';
}

function actionForClassification(classification) {
  if (classification === 'blocked_secret') return 'block';
  if (classification === 'sensitive_context') return 'redact_before_export';
  return 'allow_reviewed_promotion';
}

function buildMemoryStoreGovernance(input = {}) {
  const files = Array.isArray(input.files) ? input.files : [];
  const records = files.map((file) => {
    const path = typeof file === 'string' ? file : file.path;
    const classification = classifyMemoryFile(path);
    return {
      path: normalizeText(path),
      classification,
      promotable: !['blocked_secret', 'sensitive_context'].includes(classification),
      action: actionForClassification(classification),
    };
  }).filter((record) => record.path);

  return {
    generatedAt: normalizeText(input.generatedAt) || new Date().toISOString(),
    storeKind: 'file_backed_agent_memory',
    records,
    policy: {
      export: 'allowed_after_redaction',
      import: 'requires_schema_validation',
      promotion: 'requires_review_and_actionable_context',
      deletion: 'append_decision_journal_entry',
    },
    summary: {
      totalFiles: records.length,
      blocked: records.filter((record) => record.action === 'block').length,
      redactBeforeExport: records.filter((record) => record.action === 'redact_before_export').length,
      promotable: records.filter((record) => record.promotable).length,
    },
  };
}

module.exports = {
  actionForClassification,
  buildMemoryStoreGovernance,
  classifyMemoryFile,
};
