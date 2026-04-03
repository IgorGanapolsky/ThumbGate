#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_TEMPLATES_PATH = path.join(ROOT, 'config', 'gate-templates.json');

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function loadGateTemplates(filePath = DEFAULT_TEMPLATES_PATH) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Gate templates file not found: ${filePath}`);
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!parsed || !Array.isArray(parsed.templates)) {
    throw new Error(`Gate templates file ${filePath} is missing a "templates" array`);
  }

  return parsed;
}

function listGateTemplates(filePath = DEFAULT_TEMPLATES_PATH) {
  const config = loadGateTemplates(filePath);
  return config.templates.map((template) => ({
    id: normalizeText(template.id),
    name: normalizeText(template.name),
    category: normalizeText(template.category),
    signal: normalizeText(template.signal),
    defaultAction: normalizeText(template.defaultAction),
    severity: normalizeText(template.severity),
    pattern: normalizeText(template.pattern),
    problem: normalizeText(template.problem),
    roi: normalizeText(template.roi),
    rollout: normalizeText(template.rollout),
  }));
}

function summarizeGateTemplates(filePath = DEFAULT_TEMPLATES_PATH) {
  const templates = listGateTemplates(filePath);
  const categories = {};
  const byAction = {};

  for (const template of templates) {
    const category = template.category || 'Other';
    categories[category] = (categories[category] || 0) + 1;
    const action = template.defaultAction || 'unknown';
    byAction[action] = (byAction[action] || 0) + 1;
  }

  return {
    total: templates.length,
    categories,
    byAction,
    templates,
  };
}

module.exports = {
  DEFAULT_TEMPLATES_PATH,
  listGateTemplates,
  loadGateTemplates,
  summarizeGateTemplates,
};
